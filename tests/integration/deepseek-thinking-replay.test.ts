import {it,expect} from 'vitest';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProjectDB} from '@dream/project-db';
import {usageCost} from '@dream/config';
import {infer,requestBody} from '../../packages/orchestrator/src/inference';
import {handleAI} from '../../supabase/functions/dream-gateway/ai';
import {deepseekMessagesEndpoint} from '../../supabase/functions/dream-gateway/providers';

const gatewayDb={rpc:async()=>({data:'usage',error:null}),from:()=>({update:()=>({eq:async()=>({error:null})})})};
const png={type:'image',source:{type:'base64',media_type:'image/png',data:'iVBORw0KGgo='}};
const tools=[{name:'look',description:'Look at a frame',input_schema:{type:'object',properties:{}}}];
const named=(records:any[])=>new Response(records.map(r=>`event: ${r.type}\ndata: ${JSON.stringify(r)}\n\n`).join(''),{headers:{'content-type':'text/event-stream'}});
/** DeepSeek's answer to step n: thinking (signed on the first step, unsigned after), then a call. */
const answer=(n:number)=>named([{type:'message_start',message:{id:'m'+n,type:'message',role:'assistant',model:'deepseek-flash',content:[],stop_reason:null,usage:{input_tokens:900,cache_read_input_tokens:3000*n,output_tokens:1}}},
 {type:'content_block_start',index:0,content_block:{type:'thinking',thinking:''}},{type:'content_block_delta',index:0,delta:{type:'thinking_delta',thinking:`Plan for step ${n}.`}},
 ...(n===1?[{type:'content_block_delta',index:0,delta:{type:'signature_delta',signature:'sig-1'}}]:[]),{type:'content_block_stop',index:0},
 {type:'content_block_start',index:1,content_block:{type:'tool_use',id:'call_'+n,name:'look',input:{}}},{type:'content_block_stop',index:1},
 {type:'message_delta',delta:{stop_reason:'tool_use'},usage:{output_tokens:120}},{type:'message_stop'}]);

it('sends Roux its own earlier thinking on every later step through the Messages route, after a picture becomes its note too',async()=>{
 const db=new ProjectDB(mkdtempSync(join(tmpdir(),'dream-ds-replay-')),'Replay');
 try{
  const toDeepSeek:{url:string;body:any}[]=[];
  const deepseek:typeof fetch=async(url,init)=>{toDeepSeek.push({url:String(url),body:JSON.parse(String(init?.body))});return answer(toDeepSeek.length);};
  // The engine talks to the real gateway handler, which talks to a stand-in for DeepSeek.
  const gateway:typeof fetch=async(url,init)=>{
   if(!String(url).endsWith('/ai'))return Response.json({},{status:404});
   const result=await handleAI(requestBody(init?.body),'user',{db:gatewayDb,key:'anthropic',providerKeys:{deepseek:'ds-test'},fetcher:deepseek,deepseekRoute:'messages'});
   return result.stream?new Response(result.stream,{headers:{'content-type':'text/event-stream'}}):Response.json(result.body,{status:result.status});
  };
  const step=(messages:any[])=>infer({db,config:{url:'https://fixture.invalid',token:'fixture',accountId:'account'},resume:0,input:{model:'deepseek-flash',system:'Edit',messages,tools,turnId:'turn',purpose:'execution',phase:'main',profile:{version:1,role:'executor',effort:'high',complexity:'normal',reason:'fixture'},max_tokens:4096}},{fetch:gateway});
  const opening={role:'user',content:[{type:'text',text:'Trim the intro'},png]};
  const first=await step([opening]);
  expect(first.content[0]).toEqual({type:'thinking',thinking:'Plan for step 1.',signature:'sig-1'});
  // The agent saves the response as it came (code-agent pushes response.content) and adds the call's result.
  const history:any[]=[opening,{role:'assistant',content:first.content},{role:'user',content:[{type:'tool_result',tool_use_id:'call_1',content:'Seen'}]}];
  const second=await step(history);
  expect(toDeepSeek[1].body.messages[1].content[0]).toEqual({type:'thinking',thinking:'Plan for step 1.',signature:'sig-1'});
  // The picture already seen is swapped for its note: DeepSeek still gets both earlier thinking blocks, the unsigned one as it came.
  history[0]={role:'user',content:'Trim the intro (the frame was seen: a title card)'};
  history.push({role:'assistant',content:second.content},{role:'user',content:[{type:'tool_result',tool_use_id:'call_2',content:'Seen'}]});
  await step(history);
  expect(toDeepSeek.map(c=>c.url)).toEqual([deepseekMessagesEndpoint,deepseekMessagesEndpoint,deepseekMessagesEndpoint]);
  const third=toDeepSeek[2].body.messages;
  expect(third[1].content[0]).toEqual({type:'thinking',thinking:'Plan for step 1.',signature:'sig-1'});expect(third[3].content[0]).toEqual({type:'thinking',thinking:'Plan for step 2.'});
  expect(toDeepSeek[0].body.messages[0].content[1]).toEqual(png);
  // Each call is recorded with the route that answered and the gateway's own price.
  const usage=db.events().filter(e=>e.type==='ai.usage').map(e=>e.payload as any);
  expect(usage.map(u=>u.route)).toEqual(['messages','messages','messages']);
  expect(usage[1].costUsd).toBeCloseTo(usageCost('deepseek-flash',{input_tokens:900,cache_read_input_tokens:6000,output_tokens:120}),6);
 }finally{db.close();}
});
