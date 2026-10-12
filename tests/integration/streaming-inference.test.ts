import {it,expect} from 'vitest';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProjectDB} from '@dream/project-db';
import {infer} from '../../packages/orchestrator/src/inference';
import {readMessageStream} from '../../supabase/functions/_shared/stream';
import {handleAI} from '../../supabase/functions/dream-gateway/ai';
// Historical journal compatibility; new execution is covered by code-agent.test.ts.

const event=(type:string,data:any={})=>({type,...data});
function events(stop='tool_use',partial=false){return[
 event('message_start',{message:{id:'message',role:'assistant',content:[],usage:{input_tokens:10,cache_read_input_tokens:20,output_tokens:1}}}),
 event('content_block_start',{index:0,content_block:{type:'thinking',thinking:'',signature:''}}),
 event('content_block_delta',{index:0,delta:{type:'thinking_delta',thinking:'Private fixture reasoning'}}),
 event('content_block_delta',{index:0,delta:{type:'signature_delta',signature:'signed'}}),
 event('content_block_stop',{index:0}),
 event('content_block_start',{index:1,content_block:{type:'tool_use',id:'create',name:'create_visual',input:{}}}),
 event('content_block_delta',{index:1,delta:{type:'input_json_delta',partial_json:'{"definition":"Dream '}}),
 ...(!partial?[event('content_block_delta',{index:1,delta:{type:'input_json_delta',partial_json:'\u03c0 \ud83c\udfac"}'}})]:[]),
 event('content_block_stop',{index:1}),event('message_delta',{delta:{stop_reason:stop},usage:{output_tokens:30}}),event('message_stop')
 ];}
function streamed(values:any[],chunkSize=17){const data=new TextEncoder().encode(values.map(v=>`event: ${v.type}\r\ndata: ${JSON.stringify(v)}\r\n\r\n`).join(''));return new Response(new ReadableStream({start(c){for(let i=0;i<data.length;i+=chunkSize)c.enqueue(data.slice(i,i+chunkSize));c.close();}}),{headers:{'Content-Type':'text/event-stream','request-id':'provider-fixture'}});}

it('reassembles arbitrarily split UTF-8, tool JSON and signed thinking with cumulative usage',async()=>{
 const result=await readMessageStream(streamed(events(),1));expect(result.content[0]).toEqual({type:'thinking',thinking:'Private fixture reasoning',signature:'signed'});expect(result.content[1].input).toEqual({definition:'Dream \u03c0 \ud83c\udfac'});expect(result.usage).toMatchObject({input_tokens:10,output_tokens:30,cache_read_input_tokens:20});
 await expect(readMessageStream(streamed(events().slice(0,-1)))).rejects.toThrow('before the message finished');
 await expect(readMessageStream(streamed([...events().slice(0,3),event('error',{error:{type:'overloaded_error',message:'Overloaded'}})]))).rejects.toThrow('Overloaded');
});

it('gateway relays streams and records usage, while client cancellation retains an uncertain reservation',async()=>{
 const updates:any[]=[];const db={rpc:async()=>({data:'usage'}),from:()=>({update:(value:any)=>({eq:async()=>{updates.push(value);return{};}})})};
 const body={model:'claude-sonnet-5-5',requestId:'one',messages:[],stream:true,max_tokens:32768};
 const result=await handleAI(body,'user',{db,key:'fixture',fetcher:async(_url,init)=>{expect(JSON.parse(String(init?.body))).toMatchObject({stream:true,max_tokens:32768});return streamed(events());}});
 const message=await readMessageStream(new Response(result.stream,{headers:{'Content-Type':'text/event-stream'}}));expect(message.dream_request).toMatchObject({status:'completed',providerRequestId:'provider-fixture'});expect(updates).toHaveLength(1);expect(updates[0]).toMatchObject({status:'completed',input_tokens:10,output_tokens:30,cache_read_tokens:20});
 let canceled=false;const hanging=await handleAI({...body,requestId:'two'},'user',{db,key:'fixture',fetcher:async()=>new Response(new ReadableStream({start(c){c.enqueue(new TextEncoder().encode(': keep alive\n\n'));},cancel(){canceled=true;}}),{headers:{'Content-Type':'text/event-stream'}})});
 await hanging.stream!.cancel();expect(canceled).toBe(true);expect(updates.at(-1).status).toBe('uncertain');
});

it('automatically increases creative output capacity without executing truncated tool definitions and counts every attempt',async()=>{
 const db=new ProjectDB(mkdtempSync(join(tmpdir(),'dream-stream-')),'Streaming');const capacities:number[]=[];
 try{
  const input={model:'claude-sonnet-5-5',system:'Create an original animation',messages:[{role:'user',content:'Create'}],tools:[],turnId:'turn',purpose:'routine',max_tokens:8192};
  const response=await infer({db,config:{url:'https://fixture.invalid',token:'fixture'},input,resume:0},{fetch:async(_url,init)=>{capacities.push(JSON.parse(String(init?.body)).max_tokens);return streamed(capacities.length===1?events('max_tokens',true):events());}});
  expect(capacities).toEqual([8192,16384]);expect(response.content[1].input).toEqual({definition:'Dream \u03c0 \ud83c\udfac'});expect(db.state().versions).toHaveLength(1);
  const usage=db.db.prepare("SELECT json FROM events WHERE type='ai.usage'").all() as {json:string}[];expect(usage).toHaveLength(2);expect(usage.map(row=>JSON.parse(row.json).stopReason)).toEqual(['max_tokens','tool_use']);
 }finally{db.close();}
});

it('continues the provider request after subscriber loss and saves its full result',async()=>{
 const records=new Map<string,any>();const requests:any={claim:async(body:any)=>{const old=records.get(body.requestId);if(old)return{owner:false,record:old};const record={status:'running'};records.set(body.requestId,record);return{owner:true,record};},read:async(_user:string,id:string)=>records.get(id),finish:async(_user:string,id:string,status:string,response:any)=>{records.set(id,{status,response});}};
 const updates:any[]=[],db={rpc:async()=>({data:'usage'}),from:()=>({update:(value:any)=>({eq:async()=>{updates.push(value);return{};}})})};let complete!:()=>void,providerCalls=0;
 const source=new ReadableStream<Uint8Array>({start(controller){complete=()=>{controller.enqueue(new TextEncoder().encode(events().map(value=>'event: '+value.type+'\ndata: '+JSON.stringify(value)+'\n\n').join('')));controller.close();};}});
 const body={model:'claude-sonnet-5-5',requestId:'durable',messages:[],stream:true};
 const first=await handleAI(body,'user',{db,key:'fixture',requests,fetcher:async()=>{providerCalls++;return new Response(source,{headers:{'Content-Type':'text/event-stream'}});}});
 await first.stream!.cancel();complete();await first.finished;expect(records.get('durable').status).toBe('completed');
 const replay=await handleAI(body,'user',{db,key:'fixture',requests,fetcher:async()=>{throw new Error('Must not generate twice');}});expect(replay.body.content[1].name).toBe('create_visual');expect(providerCalls).toBe(1);expect(updates).toHaveLength(1);
});

it('records a response that cannot be decoded with what the stream showed, then retries it',async()=>{
 const db=new ProjectDB(mkdtempSync(join(tmpdir(),'dream-stream-failure-')),'Stream failure');let attempts=0;
 try{
  const input={model:'claude-sonnet-5-5',system:'Edit',messages:[{role:'user',content:'Edit'}],tools:[],turnId:'turn',purpose:'execution',phase:'main',max_tokens:8192};
  // The first stream stops a tool call's block without ever closing it, then ends the message.
  const broken=[event('dream_request',{providerRequestId:'provider-broken'}),...events().filter(e=>!(e.type==='content_block_stop'&&e.index===1))];
  const response=await infer({db,config:{url:'https://fixture.invalid',token:'fixture'},input,resume:0},{wait:async()=>{},fetch:async url=>{
   if(!String(url).endsWith('/ai'))return Response.json({},{status:404});
   return streamed(attempts++===0?broken:events());}});
  expect(response.stop_reason).toBe('tool_use');expect(attempts).toBe(2);
  const failed=(db.db.prepare("SELECT json FROM events WHERE type='ai.inference_failed'").all() as {json:string}[]).map(r=>JSON.parse(r.json));
  expect(failed).toHaveLength(1);expect(failed[0]).toMatchObject({turnId:'turn',model:'claude-sonnet-5-5',code:'invalid_stream',providerRequestId:'provider-broken',diagnostics:{openBlocks:[1]}});
  expect(failed[0].diagnostics.recent).toEqual(expect.arrayContaining(['content_block_delta','message_stop']));expect(failed[0].diagnostics.blocks).toEqual(['thinking','tool_use']);
 }finally{db.close();}
});

it('names a stream event that is not JSON as an invalid stream, with what arrived',async()=>{
 const body=new TextEncoder().encode('event: message_start\ndata: {"type":"message_start","message":{"content":[],"usage":{}}}\n\nevent: content_block_delta\ndata: {"type":"content_bl\n\n');
 const failure=await readMessageStream(new Response(new ReadableStream({start(c){c.enqueue(body);c.close();}}),{headers:{'Content-Type':'text/event-stream'}})).then(()=>undefined,error=>error);
 expect(failure).toMatchObject({code:'invalid_stream',diagnostics:{event:'content_block_delta',snippet:'{"type":"content_bl',recent:['message_start']}});
});
