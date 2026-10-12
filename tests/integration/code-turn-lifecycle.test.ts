import {it,expect} from 'vitest';
import {mkdtempSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {ProjectDB} from '@dream/project-db';
import {codeAgent} from '../../packages/orchestrator/src/code-agent';
import {assertToolExchanges} from '../../packages/orchestrator/src/tool-exchanges';
import {parseCodeRoute} from '../../packages/orchestrator/src/code-director';
import {Director} from '../../packages/orchestrator/src/code-director';
import {parseCodeTool} from '../../packages/orchestrator/src/code-tools';
import {models} from '@dream/config';
import {intelligence} from '../../packages/orchestrator/src/intelligence';
import {budgetRequest} from '../../packages/orchestrator/src/context-budget';
import {usageCost,inferencePolicy} from '../../supabase/functions/dream-gateway/inference-policy';

const fixture=()=>{const db=new ProjectDB(mkdtempSync(join(tmpdir(),'dream-turn-v2-')));db.setMeta('pending_request',JSON.stringify({turnId:'turn'}));return db;};
const base=(db:ProjectDB)=>({db,turnId:'turn',text:'Answer the question',model:models.editor,readOnly:true,signal:new AbortController().signal,publish:()=>{},workspace:{initialize:async()=>{},context:()=>({}),execute:async()=>({read:true})}});
it('rechecks a saved blocker on explicit resume instead of returning it forever',async()=>{const db=fixture();try{db.saveState('code-agent:turn:main',{protocolVersion:2,messages:[{role:'user',content:'inspect'}],results:[],completed:{},failures:{},model:models.editor,outcome:{status:'blocked',summary:'Resource unavailable',evidence:[],nextAction:'Resume after recovery.'},resumeCount:0});db.setMeta('resume_count:turn','1');let calls=0;const result=await codeAgent({...base(db),infer:async(_model,_system,messages)=>{calls++;assertToolExchanges(messages);expect(messages.at(-1).content).toContain('Recheck the blocker');return{stop_reason:'end_turn',content:[{type:'text',text:'Recovered.'}]};}});expect(calls).toBe(1);expect(result.outcome.status).toBe('complete');}finally{db.close();}});
it('constrains routing to a provider schema that permits an absent approval quote',()=>{const config=inferencePolicy(models.router,'routing').output_config;expect(config).toMatchObject({format:{type:'json_schema',schema:{additionalProperties:false,properties:{approvalQuote:{type:['string','null']},intelligence:{enum:['haiku','sonnet','opus']}}}}});expect(inferencePolicy(models.editor,'execution').output_config).not.toHaveProperty('format');});
it('accepts a natural answer in one inference without asking the model to finish again',async()=>{const db=fixture();let calls=0;try{const result=await codeAgent({...base(db),infer:async()=>{calls++;return{stop_reason:'end_turn',content:[{type:'text',text:'The opening works; shorten the pause at five seconds.'}]};}});expect(result.outcome.status).toBe('complete');expect(calls).toBe(1);assertToolExchanges(db.loadState<any>('code-agent:turn:main').messages);}finally{db.close();}});
it('closes a finish exchange and skips later calls in the same response',async()=>{const db=fixture();let effects=0;try{await codeAgent({...base(db),workspace:{initialize:async()=>{},context:()=>({}),execute:async()=>{effects++;return{};}},infer:async()=>({stop_reason:'tool_use',content:[{type:'tool_use',id:'done',name:'finish',input:{status:'complete',summary:'Answer.',evidence:[]}},{type:'tool_use',id:'late',name:'read_file',input:{path:'extra.txt'}}]})});const checkpoint=db.loadState<any>('code-agent:turn:main');expect(checkpoint.pending).toBeUndefined();expect(checkpoint.messages.at(-1).content.map((r:any)=>r.tool_use_id)).toEqual(['done','late']);expect(effects).toBe(0);assertToolExchanges(checkpoint.messages);}finally{db.close();}});
it('repairs the reported saved-history ordering without replaying effects',async()=>{const db=fixture();try{db.saveState('code-agent:turn:main',{messages:[{role:'user',content:'old question'},{role:'assistant',content:[{type:'tool_use',id:'old-finish',name:'finish',input:{status:'complete',summary:'Done',evidence:[]}}]},{role:'user',content:'can you make the changes for me'},{role:'user',content:[{type:'tool_result',tool_use_id:'old-finish',content:'{"finished":true}'}]}],results:[],completed:{},failures:{},model:'claude-sonnet-5-5'});await codeAgent({...base(db),infer:async(model,_system,messages)=>{expect(model).toBe('claude-haiku-5-5');assertToolExchanges(messages);expect(messages[2].content[0].tool_use_id).toBe('old-finish');expect(messages[3].content).toBe('can you make the changes for me');return{stop_reason:'end_turn',content:[{type:'text',text:'Recovered.'}]};}});expect(db.loadState<any>('code-agent:turn:main').protocolVersion).toBe(2);}finally{db.close();}});
it('queues resume feedback after a complete tool exchange',async()=>{const db=fixture();try{db.saveState('code-agent:turn:main',{protocolVersion:2,messages:[{role:'user',content:'inspect'},{role:'assistant',content:[{type:'tool_use',id:'read',name:'read_file',input:{path:'x'}}]}],pending:[{type:'tool_use',id:'read',name:'read_file',input:{path:'x'}}],results:[],completed:{},failures:{},model:models.editor});db.setMeta('resume_input:turn',JSON.stringify({count:1,text:'Use the new instructions'}));await codeAgent({...base(db),infer:async(_model,_system,messages)=>{assertToolExchanges(messages);expect(messages.at(-1).content).toBe('Use the new instructions');return{stop_reason:'end_turn',content:[{type:'text',text:'Updated.'}]};}});}finally{db.close();}});
it('normalizes optional nulls and does not turn creative execution into plan approval',()=>{expect(parseCodeRoute({route:'plan',intelligence:'opus',complexity:'difficult',reason:'Creative work',approvalQuote:null},'Create a phone case video','auto').route).toBe('local');expect(parseCodeTool('read_file',{path:'project.json',scope:null})).toMatchObject({scope:'workspace'});expect(()=>parseCodeTool('read_file',{path:null})).toThrow();});
it('gives the Haiku writer a working budget and accounts for both Haiku price tiers',()=>{const db=fixture();try{expect(intelligence(models.editor,'execution').role).toBe('executor');expect(intelligence(models.router,'routing').role).toBe('router');expect(budgetRequest(db,{model:models.editor,purpose:'execution',system:'Write code',messages:[{role:'user',content:'work'}],tools:[],max_tokens:8192}).target).toBe(80000);expect(budgetRequest(db,{model:models.director,purpose:'execution',system:'Edit',messages:[{role:'user',content:'work'}],tools:[],max_tokens:8192}).target).toBe(180000);expect(usageCost(models.editor,{input_tokens:50000,output_tokens:10000},[.1,.5])).toBe(.01);expect(usageCost(models.editor,{input_tokens:100001,output_tokens:10000},[.1,.5])).toBeCloseTo(.0750005);expect(inferencePolicy(models.editor).thinking?.display).toBe('summarized');}finally{db.close();}});
it('lets Opus make a whole new video itself, with every tool including helpers, and end with its own recap',async()=>{
 const db=fixture(),requests:{model:string;purpose:string;tools:string[]}[]=[];let calls=0;
 try{
  const workspace={initialize:async()=>{},context:()=>({}),execute:async(name:string)=>name==='publish_project'?{publication:{versionId:db.head(),assets:[],unchanged:true}}:{ok:true}};
  const director=new Director(db,async()=>({url:'fixture',token:'fixture'}),()=>{},undefined,undefined,undefined,undefined,workspace);
  director.inference=async(model,_system,_messages,tools=[],_turn,_force,purpose='execution')=>{
   requests.push({model,purpose,tools:(tools as any[]).map(t=>t.name)});
   if(purpose==='routing')return{content:[{type:'text',text:JSON.stringify({route:'local',intelligence:'opus',complexity:'difficult',reason:'Creative scene',approvalQuote:null})}],stop_reason:'end_turn',usage:{}};
   return ++calls===1?{content:[{type:'tool_use',id:'write',name:'write_file',input:{path:'src/scene.tsx',content:'export default()=>null;'}},{type:'tool_use',id:'pub',name:'publish_project',input:{}}],stop_reason:'tool_use',usage:{}}:{content:[{type:'text',text:'I added the product scene; check the title timing.'}],stop_reason:'end_turn',usage:{}};
  };
  await director.message('Create an elegant product scene');
  expect(db.getMeta('ai_status')).toBe('complete');
  expect(requests.map(r=>r.purpose)).toEqual(['routing','execution','execution']);expect(requests.filter(r=>r.purpose==='execution').every(r=>r.model===models.director)).toBe(true);
  const agent=requests.find(r=>r.purpose==='execution')!;expect(agent.tools).toEqual(expect.arrayContaining(['write_file','run_command','view_media','publish_project','delegate','finish']));
  for(const gone of ['hand_off','switch_to_orchestrated','edit_timeline'])expect(agent.tools).not.toContain(gone);
  const final=db.state().messages.filter(m=>m.role==='assistant').at(-1)!;expect(final.text).toBe('I added the product scene; check the title timing.');expect(final.report).toMatchObject({kind:'completion'});
 }finally{db.close();}
});
it('lets Haiku complete a simple exact edit alone without consulting Opus',async()=>{
 const db=fixture(),purposes:string[]=[],models_:string[]=[];let calls=0;
 try{
  const workspace={initialize:async()=>{},context:()=>({}),execute:async(name:string)=>name==='publish_project'?{publication:{versionId:db.head(),assets:[],unchanged:true}}:{ok:true}};
  const director=new Director(db,async()=>({url:'fixture',token:'fixture'}),()=>{},undefined,undefined,undefined,undefined,workspace);
  director.inference=async(model,_system,_messages,_tools,_turn,_force,purpose='execution')=>{purposes.push(purpose);models_.push(model);return ++calls===1?{content:[{type:'tool_use',id:'pub',name:'publish_project',input:{}}],stop_reason:'tool_use',usage:{}}:{content:[{type:'tool_use',id:'done',name:'finish',input:{status:'complete',summary:'Trimmed the opening.'}}],stop_reason:'tool_use',usage:{}};};
  await director.message('Trim the first clip to 3 seconds');
  expect(db.getMeta('ai_status')).toBe('complete');expect(purposes).toEqual(['execution','execution']);expect(models_.every(m=>m===models.editor)).toBe(true);
 }finally{db.close();}
});
