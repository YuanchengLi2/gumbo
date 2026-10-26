/** A stand-in for Supabase Auth and the gateway on this computer, so the extension runs end to end in tests at no cost:
 * sign-in codes, token refresh, /ai streamed as Anthropic events from a script with set delays, and the account
 * routes. It also serves the test pages (test/pages) and the editor libraries they load. */
import {createServer,type IncomingMessage,type ServerResponse} from 'node:http';
import {gunzipSync} from 'node:zlib';
import {readFileSync,existsSync,statSync} from 'node:fs';
import {resolve,extname} from 'node:path';

export type Reply={text?:string;json?:unknown;firstMs?:number;chunkMs?:number;chunks?:string[];status?:number;error?:{type:string;message:string}};
export type Script=(body:any)=>Reply|Promise<Reply>;
export type Standin={url:string;bodies:any[];script:Script;timing:string;close():Promise<void>};
const pages=resolve(import.meta.dirname,'pages'),modules=resolve(import.meta.dirname,'../../../node_modules');
const types:Record<string,string>={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.json':'application/json','.ogg':'audio/ogg','.wav':'audio/wav','.mp4':'video/mp4','.webm':'video/webm','.png':'image/png'};
const wait=(ms:number)=>new Promise(r=>setTimeout(r,ms));

export async function startStandin(script:Script=()=>({text:''})):Promise<Standin>{
 const state:Standin={url:'',bodies:[],script,timing:'auth;dur=4, reserve;dur=12, provider;dur=150',close:async()=>{}};
 const server=createServer((req,res)=>void route(req,res).catch(error=>{res.statusCode=500;res.end(String(error));}));
 async function route(req:IncomingMessage,res:ServerResponse){
  const url=new URL(req.url??'/','http://x');
  res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Headers','*');
  if(req.method==='OPTIONS'){res.end();return;}
  if(url.pathname.startsWith('/pages/')||url.pathname.startsWith('/node_modules/'))return file(url.pathname.startsWith('/pages/')?resolve(pages,'.'+url.pathname.slice(6)):resolve(modules,'.'+url.pathname.slice(13)),res);
  const body=await read(req);
  if(url.pathname==='/auth/v1/token'){
   const grant=url.searchParams.get('grant_type');
   if(grant==='pkce'&&body.auth_code!=='good-code'){res.statusCode=400;return send(res,{error_description:'Invalid sign-in code.'});}
   return send(res,{access_token:`fixture-access-${Date.now()}`,refresh_token:'fixture-refresh',expires_in:3600,user:{id:'fixture-user',email:'friend@example.com'}});
  }
  if(url.pathname==='/auth/v1/logout'){res.statusCode=204;res.end();return;}
  const gateway='/functions/v1/dream-gateway/';
  if(url.pathname===gateway+'usage')return send(res,{todayCredits:4,monthCredits:120});
  if(url.pathname===gateway+'account')return send(res,{email:'friend@example.com',plan:'free'});
  if(url.pathname===gateway+'memory-key')return send(res,{key:Buffer.alloc(32,7).toString('base64')});
  if(url.pathname===gateway+'ai'){
   if(!String(req.headers.authorization??'').startsWith('Bearer ')){res.statusCode=401;return send(res,{error:'Dream AI connection required'});}
   state.bodies.push(body);const reply=await state.script(body);
   if(reply.status&&reply.status>=400){res.statusCode=reply.status;return send(res,{error:reply.error??{type:'gateway_error',message:'Failed'}});}
   res.setHeader('Server-Timing',state.timing);
   if(body.stream===false){return send(res,reply.json??{id:'m',type:'message',role:'assistant',content:reply.text?[{type:'text',text:reply.text}]:[],stop_reason:'end_turn',usage:{input_tokens:10,output_tokens:2}});}
   res.setHeader('Content-Type','text/event-stream');
   const sse=(type:string,data:any)=>res.write(`event: ${type}\ndata: ${JSON.stringify({type,...data})}\n\n`);
   res.write(`event: dream_policy\ndata: ${JSON.stringify({pricingVersion:'fixture',thinkingDisplay:'omitted',maxTokens:body.max_tokens,features:[]})}\n\n`);
   await wait(reply.firstMs??30);
   sse('message_start',{message:{id:'m',role:'assistant',content:[],usage:{input_tokens:10,output_tokens:1}}});
   sse('content_block_start',{index:0,content_block:{type:'text',text:''}});
   for(const chunk of reply.chunks??split(reply.text??'')){if(res.destroyed)return;sse('content_block_delta',{index:0,delta:{type:'text_delta',text:chunk}});await wait(reply.chunkMs??10);}
   sse('content_block_stop',{index:0});sse('message_delta',{delta:{stop_reason:'end_turn'},usage:{output_tokens:5}});sse('message_stop',{});
   res.write(`event: dream_request\ndata: ${JSON.stringify({status:'completed',costUsd:0.00001})}\n\n`);res.end();return;
  }
  res.statusCode=404;res.end('not found');
 }
 await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
 const address=server.address() as {port:number};state.url=`http://127.0.0.1:${address.port}`;
 state.close=()=>new Promise(r=>{server.closeAllConnections();server.close(()=>r());});
 return state;
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
