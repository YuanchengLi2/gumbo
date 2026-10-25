import {it,expect} from 'vitest';
import {handleAI} from '../../supabase/functions/dream-gateway/ai';
import {AuthCache,jwtExpiry,serverTiming} from '../../supabase/functions/dream-gateway/auth-cache';
import {readMessageStream} from '../../supabase/functions/_shared/stream';

// The extension's quick calls (Tab, Ctrl+K, ranking an action, a warm-up): no thinking, nothing stored, the usage
// reservation alongside the provider call, and a closed connection that stops the model.
const event=(type:string,data:any={})=>({type,...data});
const reply=(text:string)=>[event('message_start',{message:{id:'m',role:'assistant',content:[],usage:{input_tokens:5,output_tokens:1}}}),event('content_block_start',{index:0,content_block:{type:'text',text:''}}),event('content_block_delta',{index:0,delta:{type:'text_delta',text}}),event('content_block_stop',{index:0}),event('message_delta',{delta:{stop_reason:'end_turn'},usage:{output_tokens:3}}),event('message_stop')];
const sse=(values:any[])=>new Response(values.map(v=>`event: ${v.type}\ndata: ${JSON.stringify(v)}\n\n`).join(''),{headers:{'Content-Type':'text/event-stream'}});
const noStore:any={claim:async()=>{throw new Error('A quick call must not be stored');},read:async()=>{throw new Error('read');},finish:async()=>{throw new Error('finish');}};
function database(reserve:()=>Promise<any>=async()=>({data:'usage'})){const updates:any[]=[];return{updates,db:{rpc:reserve,from:()=>({update:(value:any)=>({eq:async()=>{updates.push(value);return{};}})})}};}
const tab={model:'claude-haiku-5-5',requestId:'tab-1',purpose:'tab',stream:true,max_tokens:24,system:'Finish the text.',messages:[{role:'user',content:'Dear Sam, thanks for'}]};

it('sends a Tab call with thinking off, low effort, a small limit and only the marked cache points, and stores nothing',async()=>{
 const {db,updates}=database();let sent:any;
 const result=await handleAI(tab,'user',{db,key:'fixture',requests:noStore,fetcher:async(_url,init)=>{sent=JSON.parse(String(init?.body));return sse(reply(' the notes'));}});
 expect(sent).toMatchObject({model:'claude-haiku-5-5',max_tokens:24,stream:true,thinking:{type:'disabled'},output_config:{effort:'low'}});
 expect(sent.cache_control).toBeUndefined();expect(sent.system[0].cache_control).toEqual({type:'ephemeral'});expect(sent.fallbacks).toBeUndefined();
 const message=await readMessageStream(new Response(result.stream));expect(message.content[0].text).toBe(' the notes');
 expect(updates.at(-1)).toMatchObject({status:'completed',input_tokens:5,output_tokens:3});
});

it('starts the provider call while the usage reservation is still running',async()=>{
 let release!:(value:any)=>void,fetchedBefore=false,reserved=false;
 const {db}=database(()=>new Promise(resolve=>{release=value=>{reserved=true;resolve(value);};}));
 const timing:Record<string,number>={};
 const pending=handleAI(tab,'user',{db,key:'fixture',timing,fetcher:async()=>{fetchedBefore=!reserved;setTimeout(()=>release({data:'usage'}),20);return sse(reply(' you'));}});
 const result=await pending;expect(fetchedBefore).toBe(true);expect(result.status).toBe(200);
 expect(timing.reserve).toBeGreaterThanOrEqual(0);expect(timing.provider).toBeGreaterThanOrEqual(0);
 expect(serverTiming({auth:3.4,reserve:20,provider:181.6})).toBe('auth;dur=3, reserve;dur=20, provider;dur=182');
});

it('aborts the provider call when the reservation is refused, before anything is streamed',async()=>{
 let aborted=false;
 const {db}=database(async()=>{await new Promise(r=>setTimeout(r,10));return{data:null,error:{message:'No credits left',code:'D0004'}};});
 const result=await handleAI(tab,'user',{db,key:'fixture',fetcher:async(_url,init)=>{init?.signal?.addEventListener('abort',()=>{aborted=true;});return new Promise((_resolve,reject)=>init?.signal?.addEventListener('abort',()=>reject(new Error('aborted'))));}});
 expect(result.status).toBe(402);expect(result.body.error.type).toBe('credits_exhausted');expect(aborted).toBe(true);
});

it('stops the model as soon as the client closes the stream',async()=>{
 const {db,updates}=database();let canceled=false;
 const result=await handleAI(tab,'user',{db,key:'fixture',requests:noStore,fetcher:async()=>new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(': open\n\n'));},cancel(){canceled=true;}}),{headers:{'Content-Type':'text/event-stream'}})});
 await result.stream!.cancel();expect(canceled).toBe(true);expect(updates.at(-1)?.status).toBe('uncertain');
});

it('warms the cache with a call that generates nothing',async()=>{
 const {db}=database();let sent:any;
 const result=await handleAI({...tab,requestId:'warm',purpose:'prewarm',stream:true,max_tokens:500},'user',{db,key:'fixture',fetcher:async(_url,init)=>{sent=JSON.parse(String(init?.body));return Response.json({id:'m',type:'message',role:'assistant',content:[],stop_reason:'max_tokens',usage:{input_tokens:0,cache_creation_input_tokens:900,output_tokens:0}});}});
 expect(sent).toMatchObject({max_tokens:0,stream:false,thinking:{type:'disabled'}});expect(result.status).toBe(200);
});

it('leaves other calls as they were: stored, at least 128 tokens, with the usual policy',async()=>{
 const {db}=database();let claimed=false,sent:any;
 const requests:any={claim:async()=>{claimed=true;return{owner:true};},read:async()=>undefined,finish:async()=>{}};
 await handleAI({...tab,requestId:'chat',purpose:'answering',max_tokens:24},'user',{db,key:'fixture',requests,fetcher:async(_url,init)=>{sent=JSON.parse(String(init?.body));return sse(reply('Hi'));}});
 expect(claimed).toBe(true);expect(sent.max_tokens).toBe(128);expect(sent.thinking.type).toBe('adaptive');expect(sent.cache_control).toEqual({type:'ephemeral'});
});

it('remembers a session for a minute, never past its token, and never under the token itself',async()=>{
 let now=1_000_000;const cache=new AuthCache(60_000,10,()=>now);
 const token=(exp:number)=>`h.${btoa(JSON.stringify({exp})).replace(/=+$/,'')}.s`;
 const long=token(now/1000+3600),short=token(now/1000+10);
 expect(jwtExpiry(long)).toBe(now/1000+3600);
 await cache.set(long,{user:{id:'u'}});await cache.set(short,{user:{id:'v'}});
 expect((await cache.get(long))?.user.id).toBe('u');expect((cache as any).entries.has(long)).toBe(false);
 now+=11_000;expect(await cache.get(short)).toBeUndefined();expect((await cache.get(long))?.user.id).toBe('u');
 now+=50_000;expect(await cache.get(long)).toBeUndefined();
});
