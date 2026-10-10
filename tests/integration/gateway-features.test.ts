import {it,expect} from 'vitest';
import {handleAI,resetFallbackSupport} from '../../supabase/functions/dream-gateway/ai';
import {inferencePolicy,cachedPrompt,usageCost} from '../../supabase/functions/dream-gateway/inference-policy';

const db={rpc:async()=>({data:'usage',error:null}),from:()=>({update:()=>({eq:async()=>({error:null})})})};
const ok={content:[{type:'text',text:'ok'}],stop_reason:'end_turn',usage:{input_tokens:1000,cache_creation_input_tokens:2000,cache_creation:{ephemeral_1h_input_tokens:2000},output_tokens:100}};

it('uses one-hour caching for every breakpoint of a lead conversation and five minutes otherwise',()=>{
 expect(cachedPrompt('System',[{name:'a'}],'1h').cache_control).toEqual({type:'ephemeral',ttl:'1h'});
 expect(cachedPrompt('System',[{name:'a'}]).cache_control).toEqual({type:'ephemeral'});
 expect(inferencePolicy('claude-haiku-5-5','worker',{effort:'low'}).thinking).toMatchObject({display:'summarized'});
});

it('sends task budgets with their beta, drops them for good when the provider rejects them, and returns cost and features',async()=>{
 const sent:{beta:string;body:any}[]=[];let reject=false;
 const fetcher:typeof fetch=async(_url,init)=>{const body=JSON.parse(String(init?.body));sent.push({beta:new Headers(init?.headers).get('anthropic-beta')!,body});return reject&&body.output_config?.task_budget?Response.json({error:{type:'invalid_request_error',message:'task_budget: unknown field'}},{status:400}):Response.json(ok);};
 resetFallbackSupport();
 const request=(id:string,extra:any={})=>handleAI({model:'claude-haiku-5-5',messages:[{role:'user',content:'hi'}],requestId:id,max_tokens:1024,profile:{version:1,role:'executor',effort:'medium',complexity:'normal',reason:'fixture'},...extra},'user',{db,key:'fixture',fetcher});
 const first=await request('a',{taskBudget:{total:100000,remaining:60000},cacheTtl:'1h'});
 expect(sent[0].body.output_config.task_budget).toEqual({type:'tokens',total:100000,remaining:60000});expect(sent[0].beta).toContain('task-budgets-2026-03-13');expect(sent[0].body.cache_control).toEqual({type:'ephemeral',ttl:'1h'});
 expect(first.body.dream_request.costUsd).toBeCloseTo(usageCost('claude-haiku-5-5',ok.usage,[.1,.5]),9);expect(first.body.dream_policy.features).toEqual(expect.arrayContaining(['cache-ttl-1h','task-budgets','summarized-thinking','cost-receipts']));
 reject=true;sent.length=0;const healed=await request('b',{taskBudget:{total:100000}});expect(healed.status).toBe(200);expect(sent.map(s=>!!s.body.output_config.task_budget)).toEqual([true,false]);expect(healed.body.dream_policy.features).not.toContain('task-budgets');
 sent.length=0;await request('c',{taskBudget:{total:100000}});expect(sent.map(s=>!!s.body.output_config.task_budget)).toEqual([false]);expect(sent[0].beta).not.toContain('task-budgets');
 expect((await request('d',{taskBudget:{total:5}})).status).toBe(400);expect((await request('e',{cacheTtl:'24h'})).status).toBe(400);
 resetFallbackSupport();
});

it('shows a worker\'s summarized thinking as transient progress on its row, never as chat prose',async()=>{
 const {mkdtempSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {ProjectDB}=await import('@dream/project-db');const {RunStream}=await import('../../packages/orchestrator/src/run-stream');
 const project=new ProjectDB(mkdtempSync(join(tmpdir(),'dream-summary-')),'Summary');try{
  project.setMeta('pending_request',JSON.stringify({text:'Edit',turnId:'turn'}));
  const stream=new RunStream(project,'turn','req',undefined,true,'worker:call:intro');
  stream.accept({event:'dream_policy',data:{thinkingDisplay:'summarized'}});
  stream.accept({event:'content_block_start',data:{type:'content_block_start',index:0,content_block:{type:'thinking',thinking:''}}});
  stream.accept({event:'content_block_delta',data:{type:'content_block_delta',index:0,delta:{type:'thinking_delta',thinking:'Checking the timing.'}}});
  stream.accept({event:'content_block_stop',data:{type:'content_block_stop',index:0}});
  const events=project.turnActivity('turn')!.events!;expect(events).toHaveLength(1);expect(events[0]).toMatchObject({kind:'reasoning',text:'Checking the timing.',parent:'worker:call:intro',status:'complete'});
 }finally{project.close();}
});
