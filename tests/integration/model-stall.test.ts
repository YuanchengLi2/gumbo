import {it,expect} from 'vitest';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProjectDB} from '@dream/project-db';
import {agentModels,autoFallback} from '@dream/config';
import {infer,requestBody,stallLimits} from '../../packages/agent/src/transport';
import {agentProject,use,fakeRunner} from '../fixtures/agent-project';

const fixture=()=>new ProjectDB(mkdtempSync(join(tmpdir(),'dream-stall-')));
const config={url:'https://gateway.fixture',token:'fixture',accountId:'fixture'};
const stall={firstMs:60,gapMs:60};
const toolUse=(id:string,name:string,input:any)=>({content:[{type:'tool_use',id,name,input}],stop_reason:'tool_use',usage:{input_tokens:10,output_tokens:5}});
const encoder=new TextEncoder(),frame=(data:any)=>encoder.encode(`event: ${data.type}\ndata: ${JSON.stringify(data)}\n\n`);
/** A gateway stream: the given events, then (hung) only the gateway's pings until the request is aborted, or (not hung) the end. */
function stream(events:any[],signal:AbortSignal|null|undefined,hung:boolean){
 let timer:ReturnType<typeof setInterval>|undefined;
 return new Response(new ReadableStream({start(c){for(const e of events)c.enqueue(frame(e));if(!hung){c.close();return;}timer=setInterval(()=>{try{c.enqueue(frame({type:'ping'}));}catch{}},10);signal?.addEventListener('abort',()=>{clearInterval(timer);try{c.error(signal.reason);}catch{}},{once:true});},cancel(){clearInterval(timer);}}),{headers:{'content-type':'text/event-stream'}});
}
const opening=[{type:'message_start',message:{role:'assistant',content:[],usage:{input_tokens:10}}},{type:'content_block_start',index:0,content_block:{type:'thinking',thinking:''}},{type:'content_block_delta',index:0,delta:{type:'thinking_delta',thinking:'Looking at the clip'}}];
const reply=(text:string)=>[{type:'message_start',message:{role:'assistant',content:[],usage:{input_tokens:10}}},{type:'content_block_start',index:0,content_block:{type:'text',text:''}},{type:'content_block_delta',index:0,delta:{type:'text_delta',text}},{type:'content_block_stop',index:0},{type:'message_delta',delta:{stop_reason:'end_turn'},usage:{output_tokens:3}},{type:'message_stop'}];
const input={model:'deepseek-flash',system:'Edit',messages:[{role:'user',content:'Trim the intro'}],tools:[],turnId:'turn',purpose:'execution',max_tokens:8192};

it('treats a stream of gateway pings with no tokens as a stall, cancels it and asks once more',async()=>{
 const db=fixture();try{
  const calls:string[]=[],cancelled:string[]=[];let hungCalls=1;
  const fetcher:typeof fetch=async(url,options)=>{
   const path=String(url).slice(config.url.length);calls.push(path);
   if(path==='/ai-cancel'){cancelled.push(JSON.parse(String(options?.body)).requestId);return Response.json({});}
   if(path==='/ai')return hungCalls-->0?stream([],options?.signal,true):stream(reply('Trimmed.'),options?.signal,false);
   return Response.json({},{status:404});
  };
  // The first call hangs before its first token; the second answers.
  const response=await infer({db,config,input},{fetch:fetcher,wait:async()=>{},stall});
  expect(response.content).toEqual([{type:'text',text:'Trimmed.'}]);
  // A hung call is not polled for its status (that is the "Reconnecting to AI" wait); it is cancelled and sent again.
  expect(calls).toEqual(['/ai','/ai-cancel','/ai']);expect(cancelled).toHaveLength(1);
  expect(db.db.prepare("SELECT COUNT(*) AS n FROM events WHERE type='ai.inference_failed' AND json_extract(json,'$.code')='stalled'").get()).toMatchObject({n:1});
  // A model that goes quiet after it has started (thinking, then nothing) stalls too, and a second stall goes to the caller.
  const quiet:typeof fetch=async(url,options)=>String(url).endsWith('/ai')?stream(opening,options?.signal,true):Response.json({});
  await expect(infer({db,config,input:{...input,turnId:'quiet'}},{fetch:quiet,wait:async()=>{},stall})).rejects.toMatchObject({code:'stalled',message:expect.stringContaining('DeepSeek V4.1 Flash stopped responding twice')});
 }finally{db.close();}
});

it('does not call a network outage a stall: with the gateway out of reach the call is retried as a lost connection',async()=>{
 const db=fixture();try{
  let sent=0;
  const offline:typeof fetch=async(url,options)=>{if(!String(url).endsWith('/ai'))throw new TypeError('fetch failed');sent++;return new Promise((_resolve,reject)=>options?.signal?.addEventListener('abort',()=>reject(options.signal!.reason),{once:true}));};
  await expect(infer({db,config,input},{fetch:offline,wait:async()=>{},stall})).rejects.toMatchObject({code:'unavailable'});expect(sent).toBe(4);
 }finally{db.close();}
});

it('gives DeepSeek, which streams its thinking, a short stall limit and models that think silently a long one',()=>{
 expect(stallLimits('deepseek-flash').firstMs).toBeLessThanOrEqual(60_000);expect(stallLimits('claude-opus-5-5').gapMs).toBeGreaterThanOrEqual(300_000);
 expect(autoFallback('deepseek-flash',{deepseek:true})).toBe(agentModels.haiku);expect(autoFallback(agentModels.haiku,{deepseek:true})).toBe('deepseek-flash');
 expect(autoFallback(agentModels.haiku,{})).toBe(agentModels.sonnet);expect(autoFallback(agentModels.opus,{deepseek:true})).toBeUndefined();
});

/** The agent's gateway: providers, the cancels of hung calls, and the agent's calls answered by `execution`. */
function gateway(execution:(body:any,signal:AbortSignal|null|undefined)=>Response){
 const models:string[]=[];
 const fetcher:typeof fetch=async(url,options)=>{
  const path=String(url).replace(/^https?:\/\/[^/]+/,'');
  if(path==='/providers')return Response.json({deepseek:true});
  if(path==='/ai-cancel')return Response.json({});
  if(path!=='/ai')return Response.json({},{status:404});
  const body=requestBody(options?.body);
  if(!['execution','planning','answering'].includes(body.purpose))return Response.json({content:[{type:'text',text:'Fixture.'}],stop_reason:'end_turn',usage:{}});
  models.push(body.model);return execution(body,options?.signal);
 };
 return{models,fetcher};
}
const say=(text:string)=>({content:[{type:'text',text}],stop_reason:'end_turn',usage:{input_tokens:10,output_tokens:5}});

it('hands a request on Auto to its other model when DeepSeek hangs twice, keeping the conversation',async()=>{
 const run=await agentProject(()=>[]);try{
  let seen:any[]|undefined;
  const {models,fetcher}=gateway((body,signal)=>{
   if(body.model==='deepseek-flash'){
    // The first step answers; from then on DeepSeek hangs.
    if(!JSON.stringify(body.messages).includes('"r1-'))return Response.json(toolUse('r1-1','read',{path:'project.json'}));
    return stream([],signal,true);
   }
   seen=body.messages;return Response.json(say('Trimmed.'));
  });
  run.agent.dependencies={fetch:fetcher,wait:async()=>{},stall};
  await run.agent.message('Trim the intro',[],'auto',[],'turn',undefined,'auto');
  expect(models).toEqual(['deepseek-flash','deepseek-flash','deepseek-flash',agentModels.haiku]);
  expect(run.db.getMeta('ai_status')).toBe('complete');
  // Haiku carries on from the read DeepSeek asked for, and the conversation stays on it.
  expect(JSON.stringify(seen)).toContain('"r1-1"');expect(run.db.loadState<any>('agent-session').model).toBe(agentModels.haiku);
  expect(run.db.db.prepare("SELECT COUNT(*) AS n FROM events WHERE type='ai.model_fallback'").get()).toMatchObject({n:1});
 }finally{run.close();}
});

it('never switches a model the user picked: it is asked again, then the user is told',async()=>{
 const errors:string[]=[];
 const run=await agentProject(()=>[]);try{
  const {models,fetcher}=gateway((_body,signal)=>stream([],signal,true));
  run.agent.dependencies={fetch:fetcher,wait:async()=>{},stall};
  (run.agent as any).publish=(type:string,payload:any)=>{if(type==='ai.error')errors.push(payload.message);};
  await run.agent.message('Trim the intro',[],'auto',[],'turn',undefined,'deepseek-flash');
  expect(models).toEqual(['deepseek-flash','deepseek-flash']);
  expect(run.db.getMeta('ai_status')).toBe('interrupted');expect(errors.join(' ')).toContain('DeepSeek V4.1 Flash stopped responding twice');
  expect(run.db.loadState<any>('agent-session').model).toBe('deepseek-flash');
 }finally{run.close();}
});

it('resumes a run a network drop cut off by sending the call that failed again, as it was',async()=>{
 const run=await agentProject(()=>[]);try{
  let offline=false;const sent:any[][]=[];
  run.agent.dependencies={wait:async()=>{},fetch:async(url,options)=>{
   if(offline)throw new TypeError('fetch failed');
   const path=String(url).replace(/^https?:\/\/[^/]+/,'');if(path!=='/ai')return Response.json({},{status:404});
   const body=requestBody(options?.body);if(body.purpose!=='execution')return Response.json(say('Fixture.'));sent.push(body.messages);
   if(sent.length===1)return Response.json(toolUse('t-1','todo',{tasks:[{id:'captions',title:'Add captions',status:'running'}]}));
   if(sent.length===2){offline=true;throw new TypeError('fetch failed');}
   return Response.json(say('Captions added.'));
  }};
  await run.agent.message('Add captions',[],'auto',[],'turn');
  expect(run.db.getMeta('ai_status')).toBe('interrupted');
  offline=false;await run.agent.resume();
  // The resumed call is the one that was cut off: nothing is added for the model to chat back to.
  expect(sent[2]).toEqual(sent[1]);expect(sent).toHaveLength(3);expect(run.db.getMeta('ai_status')).toBe('complete');
  expect((run.db.db.prepare("SELECT text FROM messages WHERE role='assistant' ORDER BY rowid DESC LIMIT 1").get() as any).text).toBe('Captions added.');
 }finally{run.close();}
});

it('gives a call asked for again its own retries when the last try before the drop left it unsent',async()=>{
 const db=fixture();try{
  let connects=0,attempts=0,offline=true;
  const fetcher:typeof fetch=async url=>{
   if(!String(url).endsWith('/ai'))return Response.json({},{status:404});
   attempts++;if(offline)throw new TypeError('fetch failed');
   // Back online, but the first try still meets a reset connection.
   if(attempts===4)throw new TypeError('socket hang up');
   return Response.json({content:[{type:'text',text:'Done.'}],stop_reason:'end_turn',usage:{}});
  };
  // The account check fails on the last retry, so the call is left prepared with its retries spent.
  const connect=async()=>{if(++connects===3)throw new Error('Account connection check timed out. Saved work is unchanged.');return config;};
  await expect(infer({db,config,input,connect},{fetch:fetcher,wait:async()=>{}})).rejects.toThrow('timed out');expect(attempts).toBe(3);
  offline=false;
  await expect(infer({db,config,input,connect},{fetch:fetcher,wait:async()=>{}})).resolves.toMatchObject({content:[{type:'text',text:'Done.'}]});expect(attempts).toBe(5);
 }finally{db.close();}
});

it('pauses a run after half an hour, whatever it cost, and continue starts the clock again',async()=>{
 const {vi}=await import('vitest');
 let now=Date.parse('2026-10-22T04:00:00Z'),calls=0;const clock=vi.spyOn(Date,'now').mockImplementation(()=>now);
 // Every command takes eleven minutes.
 const run=await agentProject(()=>{calls++;return[use('c'+calls,'run',{command:'python analyse.py'})];},{workspace:{run:async request=>{now+=11*60_000;return fakeRunner()(request,new AbortController().signal,()=>{});}}});
 try{
  await run.agent.message('make it better',[],'auto',[],'turn');
  // Three eleven-minute commands: the run pauses before the fourth call, saying how to go on.
  expect(calls).toBe(3);expect(run.db.getMeta('ai_status')).toBe('interrupted');
  expect(run.db.state().messages.at(-1)).toMatchObject({role:'assistant',text:expect.stringContaining("I've paused after 33 minutes"),report:{status:'paused'}});
  await run.agent.resume();expect(calls).toBe(6);expect(run.db.getMeta('ai_status')).toBe('interrupted');
 }finally{clock.mockRestore();run.close();}
});
