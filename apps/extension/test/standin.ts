/** A stand-in for Supabase Auth and the gateway on this computer, so the extension runs end to end in tests at no cost:
 * sign-in codes, token refresh, /ai streamed as Anthropic events from a script with set delays, and the account
 * routes. It also serves the test pages (test/pages) and the editor libraries they load. */
import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import {gunzipSync} from 'node:zlib';
import {readFileSync,writeFileSync,existsSync,statSync} from 'node:fs';
import {resolve,extname} from 'node:path';
import {handleMemorySync,readSyncProfile} from '../../../supabase/functions/dream-gateway/memory-sync';
import {memorySyncServer,type SyncAccount} from './sync-server';
import {tmpdir} from 'node:os';
import {randomUUID} from 'node:crypto';

export type Reply={text?:string;json?:unknown;firstMs?:number;chunkMs?:number;chunks?:string[];status?:number;error?:{type:string;message:string};
 /** Thinking before the text, and tool calls after it (their arguments streamed a few characters at a time). */thinking?:string;tools?:{name:string;input:unknown;id?:string}[];
 /** Answered by the real model, through the gateway's own code on this computer (live runs only: it costs money). */live?:boolean};
export type Script=(body:any)=>Reply|Promise<Reply>;
export type Standin={url:string;bodies:any[];script:Script;timing:string;close():Promise<void>;
 /** Calls to the stand-in services the connectors use (Supabase's management API here). */services:{method:string;path:string;auth?:string;body?:any}[];
 /** The synced memory the stand-in gateway holds, by account: exactly what the server would see. */sync:Map<string,SyncAccount>;
 /** The plan and credits the gateway reports (a paid plan with plenty left, unless a test says otherwise). */billing:{plan:string;credits:{left:number;planTotal:number}}};
const pages=resolve(import.meta.dirname,'pages'),modules=resolve(import.meta.dirname,'../../../node_modules'),audio=resolve(import.meta.dirname,'../../../packages/web-ml/test/fixtures');
const types:Record<string,string>={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.ogg':'audio/ogg','.wav':'audio/wav','.mp4':'video/mp4','.webm':'video/webm','.png':'image/png'};
const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));

export async function startStandin(script:Script=()=>({text:''})):Promise<Standin>{
 const synced=memorySyncServer();
 const state:Standin={url:'',bodies:[],script,timing:'auth;dur=4, reserve;dur=12, provider;dur=150',close:async()=>{},services:[],sync:synced.accounts,billing:{plan:'pro',credits:{left:1100,planTotal:1250}}};
 const server=createServer((req,res)=>void route(req,res).catch(error=>{res.statusCode=500;res.end(String(error));}));
 async function route(req:IncomingMessage,res:ServerResponse){
  const url=new URL(req.url??'/','http://x');
  res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','*');
  if(req.method==='OPTIONS'){res.end();return;}
  if(url.pathname.startsWith('/audio/'))return file(resolve(audio,'.'+url.pathname.slice(6)),res);
  if(url.pathname.startsWith('/pages/')||url.pathname.startsWith('/node_modules/'))return file(url.pathname.startsWith('/pages/')?resolve(pages,'.'+url.pathname.slice(6)):resolve(modules,'.'+url.pathname.slice(13)),res);
  const body=await read(req);
  if(url.pathname.startsWith('/api.supabase.com/')){
   const path=url.pathname.slice('/api.supabase.com'.length);state.services.push({method:req.method??'GET',path,auth:req.headers.authorization,body});
   if(req.headers.authorization!=='Bearer sbp_fixture'){res.statusCode=401;return send(res,{message:'Unauthorized'});}
   if(path==='/v1/projects')return send(res,[{id:'abcd1234',name:'Gumbo',region:'us-east-1',status:'ACTIVE_HEALTHY'}]);
   if(path==='/v1/projects/abcd1234/database/query')return send(res,[{signups:42}]);
   res.statusCode=404;return send(res,{message:'Not found'});
  }
  if(url.pathname==='/auth/v1/token'){
   const grant=url.searchParams.get('grant_type');
   if(grant==='pkce'&&body.auth_code!=='good-code'){res.statusCode=400;return send(res,{error_description:'Invalid sign-in code.'});}
   return send(res,{access_token:`fixture-access-${Date.now()}`,refresh_token:'fixture-refresh',expires_in:3600,user:{id:'fixture-user',email:'friend@example.com'}});
  }
  if(url.pathname==='/auth/v1/logout'){res.statusCode=204;res.end();return;}
  const gateway='/functions/v1/dream-gateway/';
  if(url.pathname===gateway+'usage')return send(res,{todayCredits:4,monthCredits:120});
  if(url.pathname===gateway+'account')return send(res,{email:'friend@example.com',plan:'free'});
  if(url.pathname===gateway+'billing')return send(res,state.billing);
  if(url.pathname===gateway+'profile')return send(res,{name:'Dana Park',makes:['youtube','podcasts'],experience:null,heard:null});
  if(url.pathname===gateway+'memory-key')return send(res,{key:Buffer.alloc(32,7).toString('base64')});
  // Memory sync, through the gateway's own handler over the synced copy in memory (sync-server.ts).
  if(url.pathname.startsWith(gateway+'memory-sync')){
   if(!String(req.headers.authorization??'').startsWith('Bearer ')){res.statusCode=401;return send(res,{error:'Session expired'});}
   const action=url.pathname.slice(gateway.length),result=action==='memory-sync'?await readSyncProfile('fixture-user',synced.ports):await handleMemorySync(action,body,'fixture-user',synced.ports);
   res.statusCode=result.status;return send(res,result.body);
  }
  if(url.pathname===gateway+'ai'){
   if(!String(req.headers.authorization??'').startsWith('Bearer ')){res.statusCode=401;return send(res,{error:'Dream AI connection required'});}
   state.bodies.push(body);const reply=await state.script(body);
   if(reply.live)return live(body,req,res);
   if(reply.status&&reply.status>=400){res.statusCode=reply.status;return send(res,{error:reply.error??{type:'gateway_error',message:'Failed'}});}
   res.setHeader('Server-Timing',state.timing);
   if(body.stream===false){return send(res,reply.json??{id:'m',type:'message',role:'assistant',content:reply.text?[{type:'text',text:reply.text}]:[],stop_reason:'end_turn',usage:{input_tokens:10,output_tokens:2}});}
   res.setHeader('Content-Type','text/event-stream');
   const sse=(type:string,data:any)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...data})}\n\n`);
   res.write(`event: dream_policy\ndata: ${JSON.stringify({pricingVersion:'fixture',thinkingDisplay:'omitted',maxTokens:body.max_tokens,features:[]})}\n\n`);
   await wait(reply.firstMs??30);
   sse('message_start',{message:{id:'m',role:'assistant',content:[],usage:{input_tokens:10,output_tokens:1}}});
   let index=0;
   if(reply.thinking){sse('content_block_start',{index,content_block:{type:'thinking',thinking:''}});for(const chunk of split(reply.thinking)){if(res.destroyed)return;sse('content_block_delta',{index,delta:{type:'thinking_delta',thinking:chunk}});await wait(reply.chunkMs??10);}sse('content_block_stop',{index});index++;}
   if(reply.text||!reply.tools?.length){
    sse('content_block_start',{index,content_block:{type:'text',text:''}});
    for(const chunk of reply.chunks??split(reply.text??'')){if(res.destroyed)return;sse('content_block_delta',{index,delta:{type:'text_delta',text:chunk}});await wait(reply.chunkMs??10);}
    sse('content_block_stop',{index});index++;
   }
   for(const tool of reply.tools??[]){
    sse('content_block_start',{index,content_block:{type:'tool_use',id:tool.id??`toolu_${index}_${Math.random().toString(36).slice(2,8)}`,name:tool.name,input:{}}});
    const json=JSON.stringify(tool.input);for(let at=0;at<json.length;at+=7){if(res.destroyed)return;sse('content_block_delta',{index,delta:{type:'input_json_delta',partial_json:json.slice(at,at+7)}});await wait(reply.chunkMs??10);}
    sse('content_block_stop',{index});index++;
   }
   sse('message_delta',{delta:{stop_reason:reply.tools?.length?'tool_use':'end_turn'},usage:{output_tokens:5}});sse('message_stop',{});
   res.write(`event: dream_request\ndata: ${JSON.stringify({status:'completed',costUsd:0.00001})}\n\n`);res.end();return;
  }
  res.statusCode=404;res.end('not found');
 }
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const address=server.address() as {port:number};state.url=`http://127.0.0.1:${address.port}`;
 state.close=()=>new Promise(r=>{server.closeAllConnections();server.close(()=>r());});
 return state;
}
/** Live runs (GUMBO_LIVE=1): a request goes through the gateway's own handleAI, the same code that is deployed, with the
 * Anthropic key from .secrets/anthropic.env, and streams back as the gateway would send it. What each call cost is kept
 * in a ledger across runs; past the cap (GUMBO_LIVE_CAP, $4.90 by default, the user's $5) every call is refused. */
const root=resolve(import.meta.dirname,'../../..'),ledger=process.env.GUMBO_LIVE_LEDGER??resolve(tmpdir(),'gumbo-live-spend.json');
export const liveLog:{purpose:string;model:string;usd:number;ms:number;firstMs?:number;
 /** What the model wrote, before the extension's checks; and the request it answered. */out?:string;body?:any;at?:number}[]=[];
export function liveSpent():number{try{return JSON.parse(readFileSync(ledger,'utf8')).usd??0;}catch{return 0;}}
function spend(usd:number){writeFileSync(ledger,JSON.stringify({usd:liveSpent()+usd,at:new Date().toISOString()}));}
function liveKey(){
 if(process.env.ANTHROPIC_API_KEY)return process.env.ANTHROPIC_API_KEY;
 for(const file of ['.secrets/anthropic.env','.env.local']){const path=resolve(root,file);if(!existsSync(path))continue;const m=/^\s*ANTHROPIC_API_KEY\s*=\s*["']?([^"'\r\n]+)/m.exec(readFileSync(path,'utf8'));if(m)return m[1].trim();}
}
/** The gateway's code is loaded as a live run starts, not on its first call: that call's timing is the model's, as the
 * deployed gateway (loaded already) would see it. */
const deployed=process.env.GUMBO_LIVE==='deployed';
let gateway=process.env.GUMBO_LIVE&&!deployed?import('../../../supabase/functions/dream-gateway/ai.ts'):undefined;
/** GUMBO_LIVE=deployed: every request goes to the deployed gateway, as a temporary test account given what is left of
 * the cap in credits (scripts/lib/cloud-gateway.ts), so each surface runs on the model and provider key users get (Tab's
 * text on Qwen at Cerebras, whose key only the gateway holds). Signed in once per test process; closeLive() deletes it. */
let cloud:Promise<import('../../../scripts/lib/cloud-gateway').Gateway>|undefined;
/** Signs in to the deployed gateway ahead of the first request (a minute: the project's keys, the test account), so no
 * test spends its own time on it. Nothing to do on other live runs. */
export async function startLive(){if(deployed&&process.env.GUMBO_LIVE)await cloudNow();}
export async function closeLive(){const c=await cloud?.catch(()=>undefined);cloud=undefined;await c?.close();}
const cloudNow=()=>cloud??=import('../../../scripts/lib/cloud-gateway').then(m=>m.cloudGateway({budget:Math.max(0.05,Math.min(2,Number(process.env.GUMBO_LIVE_CAP??4.9)-liveSpent())),prefix:'tab-eval-',app:'gumbo-tab-eval'}));
async function live(body:any,req:IncomingMessage,res:ServerResponse){
 const key=liveKey(),cap=Number(process.env.GUMBO_LIVE_CAP??4.9);
 if(!process.env.GUMBO_LIVE||!key&&!deployed){res.statusCode=500;return send(res,{error:{type:'live_off',message:'Live runs need GUMBO_LIVE=1 and an Anthropic key, or GUMBO_LIVE=deployed.'}});}
 if(liveSpent()>=cap){res.statusCode=402;return send(res,{error:{type:'live_budget',message:`The live budget is used up ($${liveSpent().toFixed(2)} of $${cap}).`}});}
 const started=Date.now(),abort=new AbortController();req.on('close',()=>abort.abort());
 const record=(usd:number,firstMs?:number,out?:string)=>{liveLog.push({purpose:String(body.purpose),model:String(body.model),usd,ms:Date.now()-started,firstMs,out,body,at:started});spend(usd);};
 let result:{status:number;body?:any;stream?:ReadableStream<Uint8Array>};
 if(deployed){
  const {url,token}=await (await cloudNow()).connection();
  const response=await fetch(`${url}/ai`,{method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},body:JSON.stringify({...body,requestId:body.requestId??randomUUID()}),signal:abort.signal}).catch(error=>({ok:false,status:502,headers:new Headers(),json:async()=>({error:{type:'gateway_unreachable',message:String(error)}}),body:null}) as unknown as Response);
  const timing=response.headers.get('server-timing');if(timing)res.setHeader('Server-Timing',timing);
  result=/event-stream/.test(response.headers.get('content-type')??'')&&response.body?{status:response.status,stream:response.body}:{status:response.status,body:await response.json().catch(()=>({}))};
 }else{
  const {handleAI}=await (gateway??=import('../../../supabase/functions/dream-gateway/ai.ts'));
  const db={rpc:async()=>({data:randomUUID()}),from:()=>({update:()=>({eq:async()=>({})}),insert:async()=>({}),select:()=>({eq:()=>({maybeSingle:async()=>({data:null})})})})};
  result=await handleAI({...body,requestId:body.requestId??randomUUID()},'gumbo-live-test',{db,key,timeoutMs:120_000});
 }
 if(!result.stream){record(Number(result.body?.dream_request?.costUsd)||0,undefined,(result.body?.content??[]).map((b:any)=>b.text??'').join(''));res.statusCode=result.status;return send(res,result.body);}
 res.setHeader('Content-Type','text/event-stream');
 const reader=result.stream.getReader(),decoder=new TextDecoder();let text='',firstMs:number|undefined;
 try{
  for(;;){
   // A request the extension stopped (the next keystroke) ends the stream from the gateway too.
   const {done,value}=await reader.read().catch(()=>({done:true,value:undefined}));if(done||!value)break;
   if(abort.signal.aborted||res.destroyed){await reader.cancel().catch(()=>{});break;}
   const chunk=decoder.decode(value,{stream:true});text+=chunk;if(firstMs===undefined&&/"text_delta"|"input_json_delta"/.test(chunk))firstMs=Date.now()-started;
   res.write(Buffer.from(value));
  }
 }finally{
  const costs=[...text.matchAll(/"costUsd":\s*([0-9.eE+-]+)/g)];
  // A stream cut short reports no cost: its tokens are counted from what it said it used.
  const usage=[...text.matchAll(/"input_tokens":\s*(\d+)/g)].map(m=>Number(m[1])),output=[...text.matchAll(/"output_tokens":\s*(\d+)/g)].map(m=>Number(m[1]));
  const estimate=((usage.at(-1)??0)*1+(output.at(-1)??0)*5)/1e6;
  const out=[...text.matchAll(/"type":"text_delta","text":("(?:[^"\\]|\\.)*")/g)].map(m=>{try{return JSON.parse(m[1]) as string;}catch{return '';}}).join('');
  record(costs.length?Number(costs.at(-1)![1]):estimate,firstMs,out);res.end();
 }
}
/** Splits text into stream chunks of a few characters, as a model streams. */
export const split=(text:string,size=4)=>{const out:string[]=[];for(let i=0;i<text.length;i+=size)out.push(text.slice(i,i+size));return out;};
async function read(req:IncomingMessage):Promise<any>{
 const chunks:Buffer[]=[];for await(const c of req)chunks.push(c as Buffer);if(!chunks.length)return {};
 let raw=Buffer.concat(chunks);if(req.headers['content-type']==='application/x-dream-json-gzip')raw=gunzipSync(raw);
 try{return JSON.parse(raw.toString('utf8'));}catch{return {};}
}
function send(res:ServerResponse,value:unknown){res.setHeader('Content-Type','application/json');res.end(JSON.stringify(value));}
function file(path:string,res:ServerResponse){
 if(!existsSync(path)||statSync(path).isDirectory()){res.statusCode=404;res.end('missing');return;}
 res.setHeader('Content-Type',types[extname(path)]??'application/octet-stream');res.end(readFileSync(path));
}
