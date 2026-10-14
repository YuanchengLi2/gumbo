import {it,expect} from 'vitest';
import {handleAI} from '../../supabase/functions/dream-gateway/ai';
import {chatRequest,responsesRequest,providerModels} from '../../supabase/functions/dream-gateway/providers';
import {usageCost} from '../../supabase/functions/dream-gateway/inference-policy';
import {usageCost as appCost} from '@dream/config';
import {SSEDecoder,MessageAssembler} from '../../supabase/functions/_shared/stream';

const db={rpc:async()=>({data:'usage',error:null}),from:()=>({update:()=>({eq:async()=>({error:null})})})};
const png={type:'image',source:{type:'base64',media_type:'image/png',data:'iVBORw0KGgo='}};
// One exchange as the agent sends it: a system prompt, a tool call, its result with a picture, and Anthropic-only parts.
const conversation={system:[{type:'text',text:'You edit videos.',cache_control:{type:'ephemeral'}}],
 messages:[{role:'user',content:'Trim the intro'},
  {role:'assistant',content:[{type:'thinking',thinking:'',signature:'x'},{type:'text',text:'Looking first.'},{type:'tool_use',id:'call_1',name:'look',input:{at:2}}]},
  {role:'user',content:[{type:'tool_result',tool_use_id:'call_1',content:[{type:'text',text:'Frame at 2s'},png]},{type:'text',text:'Go on'}]}],
 tools:[{name:'look',description:'Look at a frame',input_schema:{type:'object',properties:{at:{type:'number'}}}},{type:'web_search_20250305',name:'web_search',max_uses:8}],
 profile:{version:1,role:'executor',effort:'high',complexity:'normal',reason:'fixture'}};
const sse=(records:unknown[],named=false)=>new Response(new ReadableStream({start(c){for(const r of records)c.enqueue(new TextEncoder().encode((named?`event: ${(r as any).type}\n`:'')+`data: ${JSON.stringify(r)}\n\n`));c.enqueue(new TextEncoder().encode('data: [DONE]\n\n'));c.close();}}),{headers:{'content-type':'text/event-stream'}});
async function read(stream:ReadableStream<Uint8Array>){const reader=stream.getReader(),decoder=new SSEDecoder(),assembler=new MessageAssembler();for(;;){const {done,value}=await reader.read();if(done)break;for(const e of decoder.push(value))assembler.accept(e);}return assembler;}

it('translates the agent\'s requests for Chat Completions and the Responses API, without Anthropic-only parts',()=>{
 const chat=chatRequest({...conversation,model:'gemini-3.8-flash'},providerModels['gemini-3.8-flash'],4096);
 expect(chat.messages[0]).toEqual({role:'system',content:'You edit videos.'});
 expect(chat.messages[2]).toEqual({role:'assistant',content:'Looking first.',tool_calls:[{id:'call_1',type:'function',function:{name:'look',arguments:'{"at":2}'}}]});
 expect(chat.messages[3]).toEqual({role:'tool',tool_call_id:'call_1',content:'Frame at 2s\n[image attached below]'});
 expect(chat.messages[4].content[1]).toEqual({type:'image_url',image_url:{url:'data:image/png;base64,iVBORw0KGgo='}});expect(chat.messages[4].content.at(-1)).toEqual({type:'text',text:'Go on'});
 expect(chat.tools).toEqual([{type:'function',function:{name:'look',description:'Look at a frame',parameters:conversation.tools[0].input_schema}}]);expect(chat.reasoning_effort).toBe('high');
 // A model without vision gets a note instead of the picture.
 expect(JSON.stringify(chatRequest({...conversation,model:'deepseek-flash'},{...providerModels['deepseek-flash'],vision:false},4096))).not.toContain('image_url');
 expect(providerModels['deepseek-v4-pro']).toBeUndefined();
 const responses=responsesRequest({...conversation,model:'gpt-6.1-sol'},providerModels['gpt-6.1-sol'],4096);
 expect(responses).toMatchObject({instructions:'You edit videos.',store:false,max_output_tokens:4096,reasoning:{effort:'high'}});
 expect(responses.input.map((i:any)=>i.type??i.role)).toEqual(['user','assistant','function_call','function_call_output','user']);
 expect(responses.tools).toEqual([{type:'function',name:'look',description:'Look at a frame',parameters:conversation.tools[0].input_schema,strict:false}]);
});

it('streams a GPT tool call back as Anthropic events and bills it at GPT\'s own rates',async()=>{
 let sent:any;
 const fetcher:typeof fetch=async(url,init)=>{sent={url,body:JSON.parse(String(init?.body)),auth:new Headers(init?.headers).get('authorization')};return sse([
  {type:'response.created',response:{id:'r1'}},
  {type:'response.output_text.delta',item_id:'m1',delta:'Trimming '},{type:'response.output_text.delta',item_id:'m1',delta:'now.'},
  {type:'response.output_item.added',item:{type:'function_call',id:'fc1',call_id:'call_9',name:'trim',arguments:''}},
  {type:'response.function_call_arguments.delta',item_id:'fc1',delta:'{"to":'},{type:'response.function_call_arguments.delta',item_id:'fc1',delta:'4}'},
  {type:'response.completed',response:{usage:{input_tokens:12000,input_tokens_details:{cached_tokens:10000},output_tokens:300}}}],true);};
 const result=await handleAI({...conversation,model:'gpt-6.1-sol',requestId:'gpt-1',max_tokens:4096,stream:true},'user',{db,key:'anthropic',providerKeys:{openai:'sk-test'},fetcher});
 expect(sent.url).toBe('https://api.openai.com/v1/responses');expect(sent.auth).toBe('Bearer sk-test');
 const assembler=await read(result.stream!),message=assembler.result();
 expect(message.content).toEqual([{type:'text',text:'Trimming now.'},{type:'tool_use',id:'call_9',name:'trim',input:{to:4}}]);
 expect(message.stop_reason).toBe('tool_use');expect(message.usage).toMatchObject({input_tokens:2000,cache_read_input_tokens:10000,output_tokens:300});
 const cost=(2000*2+10000*.1+300*10)/1e6;expect(assembler.receipt.costUsd).toBeCloseTo(cost,9);expect(appCost('gpt-6.1-sol',message.usage)).toBeCloseTo(cost,9);expect(usageCost('gpt-6.1-sol',message.usage,[2,10])).toBeCloseTo(cost,9);
});

it('answers a non-streaming request from a Gemini stream, and says which key is missing',async()=>{
 const fetcher:typeof fetch=async()=>sse([
  {choices:[{index:0,delta:{role:'assistant',content:'Done'}}]},
  {choices:[{index:0,delta:{tool_calls:[{index:0,id:'g1',function:{name:'look',arguments:'{"at":1}'}}]}}]},
  {choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:900,completion_tokens:40,prompt_tokens_details:{cached_tokens:0}}}]);
 const result=await handleAI({...conversation,model:'gemini-4-argon',requestId:'gem-1',max_tokens:2048},'user',{db,key:'anthropic',providerKeys:{google:'g-test'},fetcher});
 expect(result.status).toBe(200);expect(result.body.content).toEqual([{type:'text',text:'Done'},{type:'tool_use',id:'g1',name:'look',input:{at:1}}]);expect(result.body.stop_reason).toBe('tool_use');
 expect(result.body.dream_request.costUsd).toBeCloseTo((900*2+40*10)/1e6,9);
 const missing=await handleAI({...conversation,model:'deepseek-flash',requestId:'ds-1',max_tokens:2048},'user',{db,key:'anthropic',fetcher});
 expect(missing.status).toBe(503);expect(missing.body.error.message).toContain('DEEPSEEK_API_KEY');expect(missing.body.error.type).toBe('provider_not_configured');
});

it('sends Gemini\'s signature on a function call back with it, so a second step is not refused, and never sends it to Claude',async()=>{
 // Gemini 3 answered the vlog's first step with a call to read_file, then refused the next step (400): the call's
 // thought_signature had not come back with it.
 const sse=['data: '+JSON.stringify({choices:[{delta:{tool_calls:[{index:0,id:'call_1',type:'function',function:{name:'read_file',arguments:''},extra_content:{google:{thought_signature:'SIG=='}}}]}}]}),
  'data: '+JSON.stringify({choices:[{delta:{tool_calls:[{index:0,function:{arguments:'{"path":"project.json"}'}}]},finish_reason:'tool_calls'}],usage:{prompt_tokens:10,completion_tokens:5}}),'data: [DONE]'].join('\n\n')+'\n\n';
 const {anthropicStream,anthropicMessages}=await import('../../supabase/functions/dream-gateway/providers');
 const assembled=(await read(anthropicStream(new Response(sse),providerModels['gemini-3.8-flash'],'gemini-3.8-flash','r1').body!)).result();
 const call=assembled.content.find((b:any)=>b.type==='tool_use');expect(call).toMatchObject({id:'call_1',name:'read_file',input:{path:'project.json'},signature:'SIG=='});
 const next={model:'gemini-3.8-flash',system:'x',messages:[{role:'user',content:'why is it choppy'},{role:'assistant',content:[call]},{role:'user',content:[{type:'tool_result',tool_use_id:'call_1',content:'{}'}]}]};
 expect(chatRequest(next,providerModels['gemini-3.8-flash'],1000).messages[2].tool_calls[0]).toEqual({id:'call_1',type:'function',function:{name:'read_file',arguments:'{"path":"project.json"}'},extra_content:{google:{thought_signature:'SIG=='}}});
 expect(chatRequest({...next,model:'deepseek-flash'},providerModels['deepseek-flash'],1000).messages[2].tool_calls[0].extra_content).toBeUndefined();
 expect(JSON.stringify(anthropicMessages(next.messages))).not.toContain('SIG==');
});
