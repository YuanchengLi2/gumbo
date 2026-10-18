import {it,expect} from 'vitest';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProjectDB} from '@dream/project-db';
import {requestBody} from '../../packages/orchestrator/src/inference';
import {estimateTokens} from '../../packages/orchestrator/src/context-budget';
import {handleAI,resetFallbackSupport} from '../../supabase/functions/dream-gateway/ai';

const accounting={rpc:async()=>({data:'usage',error:null}),from:()=>({update:()=>({eq:async()=>({error:null})})})};
const compacted=(body:any)=>body.messages.find((m:any)=>typeof m.content==='string'&&m.content.includes('Older tool exchanges were compacted.'))?.content;

// On October 18 an Opus run re-wrote its whole conversation to the cache on every call after a compaction (reads stuck at
// the system prompt and tools), because each call sent a new task-budget remainder in output_config.
it('sends Claude byte-identical prompts between compactions, so each call after one reads the previous call from cache',async()=>{
 const {infer}=await import('../../packages/orchestrator/src/inference');
 const db=new ProjectDB(mkdtempSync(join(tmpdir(),'dream-task-budget-cache-')),'Opus');try{
  resetFallbackSupport();
  const sent:any[]=[];
  // What the gateway sends Anthropic, exactly: the app's request goes through the real gateway handler.
  const anthropic:typeof fetch=async(_url,init)=>{const body=JSON.parse(String(init?.body));sent.push(body);const n=sent.length;
   return Response.json({content:[{type:'thinking',thinking:'',signature:'sig'+n},{type:'tool_use',id:'read'+n,name:'read_file',input:{path:'src/shot'+n+'.tsx'}}],stop_reason:'tool_use',usage:{input_tokens:20,cache_read_input_tokens:1000,output_tokens:350+n}});};
  const app:typeof fetch=async(url,init)=>{const body=requestBody(init?.body);
   if(String(url).endsWith('/count-tokens'))return Response.json({input_tokens:Math.round(estimateTokens({system:body.system,messages:body.messages,tools:body.tools})*.9)});
   const answer=await handleAI({...body,stream:false},'user',{db:accounting,key:'fixture',fetcher:anthropic});return Response.json(answer.body,{status:answer.status});};
  const profile={version:1,role:'executor',effort:'medium',complexity:'normal',reason:'fixture'};
  const messages:any[]=[{role:'user',content:'Cut the Vietnam recap to the music.'}];
  for(let step=0;step<40;step++){
   const response=await infer({db,config:{url:'http://local-fixture',token:'fixture'},resume:0,input:{model:'claude-opus-5-5',system:'Editor',messages,tools:[{name:'read_file',description:'Read a file',input_schema:{type:'object',properties:{}}}],turnId:'turn',purpose:'execution',profile,max_tokens:16384,taskBudget:{total:120000}}},{fetch:app});
   messages.push({role:'assistant',content:response.content},{role:'user',content:[{type:'tool_result',tool_use_id:response.content.find((b:any)=>b.type==='tool_use').id,content:`// shot ${step}\n`+'export const frame=interpolate(f,[0,30],[0,1]);\n'.repeat(420)}]});
  }
  expect(sent).toHaveLength(40);
  const digests=[...new Set(sent.map(compacted).filter(Boolean))];expect(digests.length).toBeGreaterThanOrEqual(2);
  let checked=0;
  for(let k=1;k<sent.length;k++){
   const before=sent[k-1],after=sent[k];if(!compacted(after)||compacted(before)!==compacted(after))continue;checked++;
   // Everything ahead of the conversation is identical, and the conversation only grows at its end.
   const {messages:a,...restBefore}=before,{messages:b,...restAfter}=after;
   expect(JSON.stringify(restAfter)).toBe(JSON.stringify(restBefore));
   expect(JSON.stringify(b.slice(0,a.length))).toBe(JSON.stringify(a));
   // The thinking each call returned is sent back with it.
   expect(JSON.stringify(b)).toContain('"signature":"sig'+k+'"');
  }
  expect(checked).toBeGreaterThanOrEqual(10);
  // The remainder is the budget left where the compacted conversation starts, set at each compaction.
  const remainders=sent.filter(compacted).map(body=>body.output_config.task_budget.remaining);
  expect(new Set(remainders).size).toBe(digests.length);
  expect(remainders.every((value:number)=>value>0&&value<120000)).toBe(true);
  expect(sent.filter(body=>!compacted(body)).every(body=>body.output_config.task_budget.remaining===undefined)).toBe(true);
 }finally{db.close();}
});
