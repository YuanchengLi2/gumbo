import {gzipSync,gunzipSync} from 'node:zlib';
import {createHash,randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import type {ProjectDB} from '@dream/project-db';
import {engineBudgets,usageCost,modelInfo} from '@dream/config';
import {readMessageStream} from '../../../supabase/functions/_shared/stream';
import {RunStream} from './run-stream';
import {assertToolExchanges} from './tool-exchanges';
import {providerSession,accountScope,type ProviderConnection} from './provider-session';
import {InferenceError} from './errors';

/** One model call to the gateway, and nothing else: the conversation it is given is sent as it is (the session decides what
 * the conversation holds and when it is compacted). What this adds is what a call over a network needs: a saved receipt per
 * call so a crash or a dropped connection never runs a response twice and never loses one that was paid for, recovery
 * through /ai-status, a watchdog on the model's own output (the gateway pings every few seconds whatever the model does),
 * retries with backoff, one larger allowance when a response is cut off, and a usage record per response. */
export type InferenceResponse={content:any[];stop_reason:string;usage:unknown};
export type CallInput={model:string;system:string;messages:unknown[];tools:unknown[];turnId?:string;purpose:string;phase?:string;max_tokens:number;profile?:unknown;tool_choice?:unknown};
export type Dependencies={fetch?:typeof fetch;wait?:(ms:number,signal?:AbortSignal)=>Promise<void>;idleMs?:number;stall?:{firstMs:number;gapMs:number}};
type Receipt={id:string;attempt:number;capacity:number;transientRetries:number;stalls?:number;usageRecorded?:boolean;status:'prepared'|'inflight'|'complete'|'failed'|'uncertain'|'truncated';response?:InferenceResponse;error?:string;retryable?:boolean;retryAfterMs?:number;providerRequestId?:string};

/** How long a model may produce nothing before its call counts as stalled: until its first token, then between tokens.
 * DeepSeek streams its thinking, so a minute without a token is a hang; Claude, GPT and Gemini can think for minutes
 * without streaming it. */
export const stallLimits=(model:string)=>model.startsWith('deepseek')?{firstMs:60_000,gapMs:45_000}:{firstMs:300_000,gapMs:300_000};
/** Calls that never show in the chat's live stream: small helper calls. */
export const quietPurposes=new Set(['web_search','shot_index','listening','footage_overview','compaction','subagent']);
const PROGRESS=new Set(['content_block_start','content_block_delta','content_block_stop','message_delta','message_stop']);
const MAX_OUTPUT=engineBudgets.maxOutput,TRANSIENT_RETRIES=3,IDLE_MS=90_000,HARD_MS=20*60_000;
const AGENT_PURPOSES=new Set(['execution','planning','answering','subagent']);
const transientStatus=(status:number)=>[408,429,500,502,503,504,529].includes(status);
const failure=(body:any,status:number)=>typeof body?.error==='string'?body.error:typeof body?.error?.message==='string'?body.error.message:`AI request failed (${status}).`;
const visibleOutput=(response:any)=>Array.isArray(response?.content)&&response.content.some((b:any)=>b.type==='tool_use'||b.type==='text'&&String(b.text??'').trim());
function validResponse(value:any):value is InferenceResponse {
 const ids=Array.isArray(value?.content)?value.content.filter((b:any)=>b?.type==='tool_use').map((b:any)=>b.id):[];
 return !!value&&Array.isArray(value.content)&&new Set(ids).size===ids.length&&typeof value.stop_reason==='string'&&value.content.every((block:any)=>
  block&&typeof block.type==='string'&&(block.type!=='text'||typeof block.text==='string')&&
  (block.type!=='tool_use'||typeof block.id==='string'&&!!block.id&&typeof block.name==='string'&&!!block.name&&block.input&&typeof block.input==='object'));
}
/** After a server-side refusal fallback, only the text of the declined attempt continues; its calls never run. */
export function servedContent(content:any[]){const boundary=content.findLastIndex(block=>block?.type==='fallback');return boundary<0?content:[...content.slice(0,boundary).filter(block=>block?.type==='text'),...content.slice(boundary+1)];}
const served=(body:any)=>body&&Array.isArray(body.content)?{...body,content:servedContent(body.content)}:body;
/** Requests travel gzip-compressed: the agent's own code in a conversation can match the firewall in front of the gateway. */
const compressed=(value:unknown)=>({'Content-Type':'application/x-dream-json-gzip',body:gzipSync(JSON.stringify(value))});
/** A request body as sent, compressed or not (for fixtures standing in for the gateway). */
export function requestBody(body:unknown){return JSON.parse(Buffer.isBuffer(body)||body instanceof Uint8Array?gunzipSync(body as Uint8Array).toString('utf8'):String(body));}
async function replyJSON(response:Response){const text=await response.text();try{return JSON.parse(text);}catch{throw Object.assign(new Error(`The AI service answered ${response.status} with ${response.headers.get('content-type')??'no content type'} instead of a response.`),{code:'gateway_page'});}}

export async function infer(options:{db:ProjectDB;config:ProviderConnection;input:CallInput;signal?:AbortSignal;connect?:()=>Promise<ProviderConnection>;publish?:(type:string,payload:unknown)=>void},dependencies:Dependencies={}):Promise<InferenceResponse>{
 const {db,input,signal,publish}=options;let config=options.config;
 assertToolExchanges(input.messages as any[]);
 const request=dependencies.fetch??fetch,wait=dependencies.wait??(async(ms:number,s?:AbortSignal)=>{await delay(ms,undefined,{signal:s});});
 const session=providerSession(db,config,input as any),wire={...input,messages:session.messages};
 const fingerprint=createHash('sha256').update(JSON.stringify({url:config.url,account:session.account,epoch:session.epoch,input:wire})).digest('hex'),key='inference:'+fingerprint;
 const live=()=>input.turnId&&!quietPurposes.has(input.purpose)?new RunStream(db,input.turnId,receipt.id,publish,AGENT_PURPOSES.has(input.purpose)):undefined;
 let receipt:Receipt=db.loadState<Receipt>(key)??{id:randomUUID(),attempt:0,capacity:input.max_tokens,transientRetries:0,status:'prepared'};
 // Only a completed response is kept for good. A call that failed or was cut off is asked again when it is asked for
 // again (a continue after a top-up or an outage), so a failure never sticks to the conversation that met it.
 if(receipt.status==='failed'||receipt.status==='truncated')receipt={id:randomUUID(),attempt:receipt.attempt+1,capacity:input.max_tokens,transientRetries:0,status:'prepared'};
 // Each ask gets its own retries, also for a call an earlier ask left unsent.
 else if(receipt.status!=='complete'){receipt.transientRetries=0;receipt.stalls=0;}
 const save=()=>db.saveState(key,receipt);
 let started=Date.now();
 const recordUsage=(response:any)=>{
  if(receipt.usageRecorded)return;receipt.usageRecorded=true;
  const usage=response?.usage??{},costUsd=Number((typeof response?.dream_request?.costUsd==='number'?response.dream_request.costUsd:usageCost(input.model,usage)).toFixed(6));
  // Which DeepSeek route answered (messages, chat or chat-fallback), from the gateway's receipt.
  const route=Array.isArray(response?.dream_policy?.features)?response.dream_policy.features.find((f:unknown)=>typeof f==='string'&&f.startsWith('deepseek-route:'))?.slice('deepseek-route:'.length):undefined;
  // A helper's calls (task:<call id>) are counted under it, apart from the main conversation's.
  const parent=input.phase?.startsWith('task:')?input.phase:undefined;
  const event={turnId:input.turnId,requestId:receipt.id,model:input.model,purpose:input.purpose,phase:input.phase??'main',...(parent?{parent}:{}),usage,providerRequestId:receipt.providerRequestId,stopReason:response?.stop_reason,costUsd,durationMs:Date.now()-started,outputTokens:usage.output_tokens??0,visibleChars:JSON.stringify((response?.content??[]).filter((b:any)=>b?.type!=='thinking')).length,...(route?{route}:{})};
  db.event('ai.usage',event);db.recordUsage?.(event);publish?.('ai.usage',event);
 };
 const cancelRemote=async(id=receipt.id)=>{if(signal?.reason?.dreamStop==='shutdown')return;await request(config.url+'/ai-cancel',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+config.token},body:JSON.stringify({requestId:id}),signal:AbortSignal.timeout(5000)}).catch(()=>{});};
 const recover=async():Promise<any>=>{try{
  publish?.('ai.step',{id:'reconnect:'+receipt.id,label:'Reconnecting to AI',status:'running'});
  for(let n=0;n<65;n++){
   signal?.throwIfAborted();let response:Response;
   try{response=await request(config.url+'/ai-status',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+config.token},body:JSON.stringify({requestId:receipt.id}),signal:AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(10000)])});}catch{signal?.throwIfAborted();return;}
   let body:any;try{body=await response.json();}catch{return;}
   if(response.ok&&validResponse(body)){publish?.('ai.step',{id:'reconnect:'+receipt.id,label:'Reconnecting to AI',status:'complete'});return body;}
   if(response.status!==202){publish?.('ai.step',{id:'reconnect:'+receipt.id,label:'Reconnecting to AI',status:'paused'});return;}
   await wait(2000,signal);
  }
 }finally{if(signal?.aborted)await cancelRemote();}};
 // A call this process (or an earlier one) sent but never confirmed: reclaim its response, otherwise cancel it and ask again.
 if(receipt.status==='inflight'||receipt.status==='uncertain'){
  const recovered=served(await recover());
  if(recovered){receipt.response=recovered;receipt.status=recovered.stop_reason==='max_tokens'?'truncated':'complete';save();}
  else{await cancelRemote();receipt={id:randomUUID(),attempt:receipt.attempt+1,capacity:receipt.capacity,transientRetries:receipt.transientRetries,status:'prepared'};save();}
 }
 if(receipt.status==='complete'&&receipt.response){live()?.finish(receipt.response);session.record(receipt.response.content);if(!receipt.usageRecorded){recordUsage(receipt.response);save();}return receipt.response;}
 signal?.throwIfAborted();
 if(!config.token)throw new InferenceError('Gumbo AI is disconnected. Retry when online; local editing and export still work offline.','unavailable');
 const retryLater=async(reason:string,retryAfterMs?:number)=>{
  if(receipt.transientRetries>=TRANSIENT_RETRIES)throw new InferenceError(reason+' Saved work is intact; say continue to try again.','unavailable');
  const backoff=Math.max(500,Math.min(30_000,retryAfterMs??1000*2**receipt.transientRetries));
  publish?.('ai.step',{label:'Reconnecting to AI',status:'running',detail:'Retrying a temporary service failure'});
  await wait(backoff,signal);signal?.throwIfAborted();receipt={id:randomUUID(),attempt:receipt.attempt+1,capacity:receipt.capacity,transientRetries:receipt.transientRetries+1,stalls:receipt.stalls,status:'prepared'};save();
 };
 const limits=dependencies.stall??stallLimits(input.model),label=modelInfo(input.model)?.label??input.model;
 for(;;){
  if(receipt.status==='truncated'){
   // A response that spent its whole allowance thinking is not retried with more room; the caller tells the model to act.
   if(AGENT_PURPOSES.has(input.purpose)&&!visibleOutput(receipt.response))throw Object.assign(new InferenceError('The response used its whole allowance thinking before acting.','truncated'),{thinkingOnly:true});
   if(receipt.capacity>=MAX_OUTPUT||receipt.capacity>=input.max_tokens*2)throw new InferenceError('The response was longer than one reply can be. Ask for a smaller piece at a time.','truncated');
   receipt={id:randomUUID(),attempt:receipt.attempt+1,capacity:Math.min(MAX_OUTPUT,receipt.capacity*2),transientRetries:receipt.transientRetries,status:'prepared'};save();
   publish?.('ai.step',{label:'Continuing with more room',status:'running'});
  }
  if(receipt.status==='failed'){
   if(!receipt.retryable)throw new InferenceError(receipt.error??'The AI request failed. Say continue to try again.','provider');
   await retryLater(receipt.error??'The AI service is temporarily unavailable.',receipt.retryAfterMs);
  }
  started=Date.now();signal?.throwIfAborted();
  if(receipt.attempt>0&&options.connect){const renewed=await options.connect();if(renewed.url!==config.url||accountScope(renewed)!==accountScope(config))throw new InferenceError('The AI connection changed. Say continue to use the new account.','authentication');config=renewed;}
  receipt.status='inflight';save();
  const stream=live();let response:Response,body:any,heard=false,providerRequestId:string|undefined;
  // Two watchdogs: one on any data (the gateway pings), one on the model's own output, so a hung model is noticed.
  const idle=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined,progress:ReturnType<typeof setTimeout>|undefined;
  const touch=()=>{if(timer)clearTimeout(timer);timer=setTimeout(()=>idle.abort(Object.assign(new Error('The AI stream stopped sending data.'),{code:'idle_timeout'})),dependencies.idleMs??IDLE_MS);};
  const quiet=(ms:number)=>{if(progress)clearTimeout(progress);progress=setTimeout(()=>idle.abort(Object.assign(new Error(`${label} stopped responding (nothing for ${Math.round(ms/1000)} seconds).`),{code:'stalled'})),ms);};
  try{
   touch();quiet(limits.firstMs);
   const {phase:_phase,...body0}=wire as any,{body:payload,...type}=compressed({...body0,requestId:receipt.id,stream:true,max_tokens:receipt.capacity});
   response=await request(`${config.url}/ai`,{method:'POST',headers:{...type,Authorization:`Bearer ${config.token}`},body:payload,signal:AbortSignal.any([...(signal?[signal]:[]),idle.signal,AbortSignal.timeout(HARD_MS)])});
   heard=true;touch();
   body=response.ok&&response.headers.get('content-type')?.includes('text/event-stream')?await readMessageStream(response,event=>{touch();if(PROGRESS.has(event.data?.type))quiet(limits.gapMs);if(event.event==='dream_request')providerRequestId=event.data?.providerRequestId;stream?.accept(event);}):await replyJSON(response);
  }catch(caught){
   const own=idle.signal.aborted&&idle.signal.reason?.code==='stalled',stalled=!signal?.aborted&&(own||!idle.signal.aborted&&/AI provider stopped sending data/.test(String((caught as Error)?.message))),error=own?idle.signal.reason:caught;
   // Every failed attempt is recorded with what the stream showed, so a failure can be diagnosed after the run.
   if(!signal?.aborted)db.event('ai.inference_failed',{turnId:input.turnId,phase:input.phase??'main',purpose:input.purpose,model:input.model,attempt:receipt.attempt,transientRetries:receipt.transientRetries,code:(error as any).code??(error as Error).name,message:String((error as Error).message).slice(0,500),diagnostics:(error as any).diagnostics,providerRequestId:(error as any).diagnostics?.providerRequestId??providerRequestId});
   stream?.interrupt((error as Error).message);receipt.status='uncertain';receipt.error=(error as Error).message;save();
   if(signal?.aborted){await cancelRemote();signal.throwIfAborted();}
   // A hung model is cancelled (so it stops billing) and asked once more; a second stall goes to the caller. Silence
   // before the gateway answered at all may be the network, so a stall needs the gateway to be reachable.
   const reachable=stalled&&(heard||await request(config.url+'/ai-status',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+config.token},body:JSON.stringify({requestId:receipt.id}),signal:AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(10000)])}).then(()=>true,()=>false));
   if(stalled&&reachable){
    await cancelRemote();receipt.status='failed';receipt.retryable=true;save();
    if((receipt.stalls??0)>=1)throw new InferenceError(`${label} stopped responding twice. Saved work is intact; say continue to try again, or pick another model.`,'stalled');
    publish?.('ai.step',{label:'Asking the AI again',status:'running',detail:`${label} stopped responding`});
    receipt={id:randomUUID(),attempt:receipt.attempt+1,capacity:receipt.capacity,transientRetries:receipt.transientRetries,stalls:(receipt.stalls??0)+1,status:'prepared'};save();continue;
   }
   const recovered=await recover();
   if(recovered){body=recovered;response=Response.json(body);}
   else{await cancelRemote();receipt.status='failed';receipt.retryable=true;save();await retryLater(error instanceof SyntaxError?'The AI response could not be decoded. Nothing from it was run.':(error as Error).message);continue;}
  }finally{if(timer)clearTimeout(timer);if(progress)clearTimeout(progress);}
  if(response.status===202){const recovered=await recover();if(recovered){body=recovered;response=Response.json(body);}else{await cancelRemote();receipt.status='failed';receipt.retryable=true;save();await retryLater('The AI response is still unconfirmed.');continue;}}
  signal?.throwIfAborted();
  body=served(body);receipt.providerRequestId=body?.dream_request?.providerRequestId;
  if(!response.ok){
   receipt.error=failure(body,response.status);
   if(['credits_exhausted','daily_limit','guest_capacity','at_capacity','budget_exceeded','spend_limit'].includes(body?.error?.type)){receipt.status='failed';receipt.retryable=false;save();throw new InferenceError(receipt.error!,'quota',response.status);}
   if(body?.error?.type==='D0002'){receipt.status='failed';receipt.retryable=false;save();throw new InferenceError(receipt.error!,'request_conflict',response.status);}
   if([401,403].includes(response.status)){receipt.status='failed';receipt.retryable=false;save();throw new InferenceError(receipt.error!,'authentication',response.status);}
   const confirmedRetry=body?.dream_request?.status==='failed'&&body?.dream_request?.retryable===true,unconfirmed=body?.dream_request?.status!=='failed'&&transientStatus(response.status);
   receipt.status='failed';receipt.retryable=confirmedRetry||unconfirmed;receipt.retryAfterMs=body?.dream_request?.retryAfterMs;save();
   if(unconfirmed)await cancelRemote();
   continue;
  }
  if(body?.stop_reason==='max_tokens'){stream?.finish(body);stream?.interrupt('The reply was cut off; nothing from it was run.');receipt.status='truncated';receipt.response=body;recordUsage(body);save();continue;}
  if(!validResponse(body)){receipt.status='failed';receipt.retryable=true;receipt.error='The AI service returned an incomplete response. Nothing from it was run.';save();continue;}
  db.db.transaction(()=>{receipt.status='complete';receipt.response=body;session.record(body.content);recordUsage(body);save();})();stream?.finish(body);
  if(receipt.transientRetries>0)publish?.('ai.step',{label:'Reconnecting to AI',status:'complete',detail:'Connection restored'});
  return receipt.response!;
 }
}
