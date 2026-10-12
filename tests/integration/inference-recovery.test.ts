import {it,expect} from 'vitest';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProjectDB} from '@dream/project-db';
import {infer,requestBody} from '../../packages/orchestrator/src/inference';
import {handleAI} from '../../supabase/functions/dream-gateway/ai';

const input={model:'claude-sonnet-5-5',system:'Edit',messages:[{role:'user',content:'Read current edit'}],tools:[],turnId:'turn',purpose:'routine',max_tokens:8192};
const result={content:[{type:'text',text:'Ready'}],stop_reason:'end_turn',usage:{input_tokens:20,output_tokens:2}};
const config={url:'http://local-fixture',token:'fixture-not-a-secret',accountId:'fixture-account'};
function fixture(){return new ProjectDB(mkdtempSync(join(tmpdir(),'dream-inference-')),'Inference');}

it('saves a complete inference before the caller checkpoint and reuses it after reopen without duplicate usage',async()=>{
 let db=fixture();const folder=db.folder;let calls=0;const fetcher:typeof fetch=async()=>{calls++;return Response.json(result);};
 try{
  expect(await infer({db,config,input,resume:0},{fetch:fetcher})).toMatchObject(result);db.close();db=new ProjectDB(folder);
  expect(await infer({db,config,input,resume:1},{fetch:fetcher})).toMatchObject(result);expect(calls).toBe(1);
  expect((db.db.prepare("SELECT COUNT(*) AS n FROM events WHERE type='ai.usage'").get() as {n:number}).n).toBe(1);
 }finally{db.close();}
});

it('retries confirmed temporary failure with backoff, and cancels then retries an unconfirmed outcome a bounded number of times',async()=>{
 const db=fixture();let calls=0;const ids:string[]=[],waits:number[]=[],tokens:string[]=[];let renewals=0;try{
  const fetcher:typeof fetch=async(_url,options)=>{calls++;tokens.push(new Headers(options?.headers).get('Authorization')!);ids.push(requestBody(options?.body).requestId);return calls===1?Response.json({error:{message:'Busy'},dream_request:{status:'failed',retryable:true,retryAfterMs:1500}},{status:529}):Response.json(result);};
  await infer({db,config,input,resume:0,connect:async()=>{renewals++;return{...config,token:'renewed'};}},{fetch:fetcher,wait:async ms=>{waits.push(ms);}});expect(calls).toBe(2);expect(renewals).toBe(1);expect(tokens).toEqual(['Bearer fixture-not-a-secret','Bearer renewed']);expect(waits).toEqual([1500]);expect(ids[0]).not.toBe(ids[1]);
  // An unconfirmed generation has no side effects: cancel it server-side and generate again, at most three more times.
  const other={...input,turnId:'uncertain'};let generations=0;const cancelled:string[]=[];const disconnected:typeof fetch=async(url,options)=>{if(String(url).endsWith('/ai-status'))return Response.json({dream_request:{status:'uncertain'}},{status:409});if(String(url).endsWith('/ai-cancel')){cancelled.push(requestBody(options?.body).requestId);return Response.json({});}generations++;throw new TypeError('Connection closed');};
  await expect(infer({db,config,input:other,resume:0},{fetch:disconnected,wait:async()=>{}})).rejects.toMatchObject({code:'unavailable'});expect(generations).toBe(4);expect(new Set(cancelled).size).toBe(4);
  await expect(infer({db,config,input:other,resume:0},{fetch:disconnected,wait:async()=>{}})).rejects.toMatchObject({code:'unavailable'});expect(generations).toBe(4);
  let resumed=0;await infer({db,config,input:other,resume:1},{fetch:async()=>{resumed++;return Response.json(result);}});expect(resumed).toBe(1);
  // A connection that recovers on retry completes the request without user action.
  const flaky={...input,turnId:'flaky'};let attempts=0;await expect(infer({db,config,input:flaky,resume:0},{wait:async()=>{},fetch:async url=>{if(String(url).endsWith('/ai-status'))return Response.json({dream_request:{status:'uncertain'}},{status:409});if(String(url).endsWith('/ai-cancel'))return Response.json({});if(++attempts===1)throw new TypeError('socket hang up');return Response.json(result);}})).resolves.toMatchObject(result);expect(attempts).toBe(2);
 }finally{db.close();}
});

it('cancels backoff without submitting another request and rejects truncated responses without executing tools',async()=>{
 const db=fixture(),controller=new AbortController();let calls=0;try{
  const fetcher:typeof fetch=async()=>{calls++;return Response.json({error:'Busy',dream_request:{status:'failed',retryable:true}},{status:529});};
  await expect(infer({db,config,input,resume:0,signal:controller.signal},{fetch:fetcher,wait:async()=>{controller.abort();}})).rejects.toThrow();expect(calls).toBe(1);
  await expect(infer({db,config,input:{...input,turnId:'truncated'},resume:0},{fetch:async()=>Response.json({...result,stop_reason:'max_tokens'})})).rejects.toThrow('exceeds one response');
 }finally{db.close();}
});

function cloud(){const updates:any[]=[];return{updates,db:{rpc:async()=>({data:'usage',error:null}),from:()=>({update:(value:any)=>({eq:async()=>{updates.push(value);return{error:null};}})})}};}
it('gateway distinguishes provider overload, quota rejection, uncertain transport, and actual usage',async()=>{
 const {db,updates}=cloud();const body={...input,requestId:'request'};
 const overloaded=await handleAI(body,'user',{db,key:'fixture',fetcher:async()=>Response.json({error:{type:'overloaded_error',message:'Busy'}},{status:529,headers:{'request-id':'provider-1'}})});
 expect(overloaded.body.dream_request).toMatchObject({status:'failed',retryable:true,providerRequestId:'provider-1'});expect(updates[0].status).toBe('failed');
 const unknown=await handleAI(body,'user',{db,key:'fixture',fetcher:async()=>{throw new TypeError('lost');}});expect(unknown.body.dream_request).toMatchObject({status:'uncertain',retryable:false});expect(updates[1].status).toBe('uncertain');
 const quota=await handleAI(body,'user',{db:{...db,rpc:async()=>({error:{code:'D0003',message:'Daily allowance'}})},key:'fixture',fetcher:async()=>{throw new Error('Must not call provider');}});expect(quota.status).toBe(429);expect(quota.body.dream_request.retryable).toBe(false);
 await handleAI(body,'user',{db,key:'fixture',fetcher:async()=>Response.json({...result,usage:{input_tokens:100,output_tokens:10,cache_read_input_tokens:50}})});expect(updates.at(-1)).toMatchObject({status:'completed',input_tokens:100,output_tokens:10,cache_read_tokens:50});
 const spend=await handleAI(body,'user',{db,key:'fixture',fetcher:async()=>Response.json({error:{type:'rate_limit_error'}},{status:429})});expect(spend.body.dream_request.retryable).toBe(false);
 const longBackoff=await handleAI(body,'user',{db,key:'fixture',fetcher:async()=>Response.json({error:{type:'overloaded_error'}},{status:529,headers:{'retry-after':'60'}})});expect(longBackoff.body.dream_request.retryable).toBe(false);
});

it('recovers the original completed response after a lost connection without another generation',async()=>{
 const db=fixture();let generations=0,polls=0;const ids:string[]=[];try{
 const response=await infer({db,config,input:{...input,turnId:'reconnect'},resume:0},{wait:async()=>{},fetch:async(url,init)=>{ids.push(requestBody(init?.body).requestId);if(String(url).endsWith('/ai-status')){polls++;return polls===1?Response.json({dream_request:{status:'running'}},{status:202}):Response.json({...result,dream_request:{status:'completed'}});}generations++;throw new TypeError('socket lost');}});
 expect(response.content).toEqual(result.content);expect(generations).toBe(1);expect(polls).toBe(2);expect(new Set(ids).size).toBe(1);expect(db.db.prepare("SELECT COUNT(*) AS n FROM events WHERE type='ai.usage'").get()).toMatchObject({n:1});
 }finally{db.close();}
});

it('never raises the cap after a thinking-only cut-off, doubles once after visible output, and keeps raised caps to one phase',async()=>{
 const db=fixture();try{const haiku={...input,model:'claude-haiku-5-5',purpose:'worker',max_tokens:16384};let sizes:number[]=[];
  const thinking={content:[{type:'thinking',thinking:'planning',signature:'sig'}],stop_reason:'max_tokens',usage:{output_tokens:16384}};
  await expect(infer({db,config,resume:0,input:{...haiku,phase:'main:worker:c:a'}},{fetch:async(_u,init)=>{sizes.push(requestBody(init?.body).max_tokens);return Response.json(thinking);}})).rejects.toMatchObject({code:'truncated',thinkingOnly:true});
  expect(sizes).toEqual([16384]);
  sizes=[];let n=0;
  await expect(infer({db,config,resume:0,input:{...haiku,phase:'main:worker:c:b',messages:[{role:'user',content:'Write b'}]}},{fetch:async(_u,init)=>{sizes.push(requestBody(init?.body).max_tokens);n++;return Response.json({content:[{type:'text',text:'partial'}],stop_reason:'max_tokens',usage:{}});}})).rejects.toMatchObject({code:'truncated'});
  expect(sizes).toEqual([16384,32768]);
  // A parallel worker never inherits another phase's raised allowance.
  sizes=[];await infer({db,config,resume:0,input:{...haiku,phase:'main:worker:c:c',messages:[{role:'user',content:'Write c'}]}},{fetch:async(_u,init)=>{sizes.push(requestBody(init?.body).max_tokens);return Response.json(result);}});
  expect(sizes).toEqual([16384]);
  // After a complete response with more room, the raised allowance is cleared.
  sizes=[];n=0;await infer({db,config,resume:0,input:{...haiku,phase:'main:worker:c:d',messages:[{role:'user',content:'Write d'}]}},{fetch:async(_u,init)=>{sizes.push(requestBody(init?.body).max_tokens);return Response.json(n++===0?{content:[{type:'text',text:'partial'}],stop_reason:'max_tokens',usage:{}}:result);}});
  expect(sizes).toEqual([16384,32768]);expect(db.getMeta('output_capacity:turn:claude-haiku-5-5:main:worker:c:d')||'').toBe('');
 }finally{db.close();}
});
