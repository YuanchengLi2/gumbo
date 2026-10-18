import {it,expect,vi} from 'vitest';
import {handleAI} from '../../supabase/functions/dream-gateway/ai';
import {chatRequest,responsesRequest,providerModels,promptCacheKey} from '../../supabase/functions/dream-gateway/providers';
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
 expect(chat.messages[2]).toEqual({role:'assistant',content:'Looking first.',tool_calls:[{id:'call_1',type:'function',function:{name:'look',arguments:'{"at":2}'},extra_content:{google:{thought_signature:'skip_thought_signature_validator'}}}]});
 expect(chat.messages[3]).toEqual({role:'tool',tool_call_id:'call_1',content:'Frame at 2s\n[image attached below]'});
 expect(chat.messages[4].content[1]).toEqual({type:'image_url',image_url:{url:'data:image/png;base64,iVBORw0KGgo='}});expect(chat.messages[4].content.at(-1)).toEqual({type:'text',text:'Go on'});
 expect(chat.tools).toEqual([{type:'function',function:{name:'look',description:'Look at a frame',parameters:conversation.tools[0].input_schema}}]);expect(chat.reasoning_effort).toBe('high');
 // A model without vision gets a note instead of the picture.
 expect(JSON.stringify(chatRequest({...conversation,model:'deepseek-flash'},{...providerModels['deepseek-flash'],vision:false},4096))).not.toContain('image_url');
 expect(providerModels['deepseek-v4-pro']).toBeUndefined();
 // DeepSeek's thinking follows the request's effort: medium thinks lightly (it would think at high on every call).
 const effort=(e?:string)=>chatRequest({...conversation,model:'deepseek-flash',...(e?{profile:{effort:e}}:{})},providerModels['deepseek-flash'],4096).reasoning_effort;
 expect([effort('low'),effort('medium'),effort('high'),effort('xhigh')]).toEqual(['low','low','high','max']);
 const responses=responsesRequest({...conversation,model:'gpt-6.1-sol'},providerModels['gpt-6.1-sol'],4096);
 expect(responses).toMatchObject({instructions:'You edit videos.',store:false,max_output_tokens:4096,reasoning:{effort:'high'}});
 expect(responses.input.map((i:any)=>i.type??i.role)).toEqual(['user','assistant','function_call','function_call_output','user']);
 expect(responses.tools).toEqual([{type:'function',name:'look',description:'Look at a frame',parameters:conversation.tools[0].input_schema,strict:false}]);
 // One cache key per user and prompt start: a later request (another turn, other messages) reads what the first cached.
 const key=(extra:object,user='user-1')=>responsesRequest({...conversation,model:'gpt-6.1-sol',turnId:'turn-1',...extra},providerModels['gpt-6.1-sol'],4096,user).prompt_cache_key;
 expect(key({})).toBe(key({turnId:'turn-2',messages:[{role:'user',content:'Something else'}]}));
 expect(key({})).not.toBe(key({},'user-2'));expect(key({})).not.toBe(key({system:'You write code.'}));expect(key({})).not.toBe(key({tools:[]}));
 expect(key({})!.length).toBeLessThanOrEqual(64);expect(promptCacheKey({turnId:'turn-9'})).toBe('gumbo-turn-9');
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
 vi.setSystemTime(new Date('2026-10-14T12:00:00Z'));// Before Gemini 4 Argon's December price.
 const fetcher:typeof fetch=async()=>sse([
  {choices:[{index:0,delta:{role:'assistant',content:'Done'}}]},
  {choices:[{index:0,delta:{tool_calls:[{index:0,id:'g1',function:{name:'look',arguments:'{"at":1}'}}]}}]},
  {choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:900,completion_tokens:40,prompt_tokens_details:{cached_tokens:0}}}]);
 const result=await handleAI({...conversation,model:'gemini-4-argon',requestId:'gem-1',max_tokens:2048},'user',{db,key:'anthropic',providerKeys:{google:'g-test'},fetcher});
 expect(result.status).toBe(200);expect(result.body.content).toEqual([{type:'text',text:'Done'},{type:'tool_use',id:'g1',name:'look',input:{at:1}}]);expect(result.body.stop_reason).toBe('tool_use');
 expect(result.body.dream_request.costUsd).toBeCloseTo((900*2+40*10)/1e6,9);
 const missing=await handleAI({...conversation,model:'deepseek-flash',requestId:'ds-1',max_tokens:2048},'user',{db,key:'anthropic',fetcher});
 expect(missing.status).toBe(503);expect(missing.body.error.message).toContain('DEEPSEEK_API_KEY');expect(missing.body.error.type).toBe('provider_not_configured');
 vi.useRealTimers();
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

it('finds Gemini\'s signature wherever the stream puts it, and gives a call without one Google\'s placeholder',async()=>{
 const {anthropicStream}=await import('../../supabase/functions/dream-gateway/providers');
 const stream=(chunks:any[])=>new Response(chunks.map(c=>'data: '+JSON.stringify(c)).join('\n\n')+'\n\ndata: [DONE]\n\n');
 const callOf=async(chunks:any[])=>(await read(anthropicStream(stream(chunks),providerModels['gemini-3.8-flash'],'gemini-3.8-flash','r').body!)).result().content.find((b:any)=>b.type==='tool_use');
 // On the choice instead of the call.
 expect(await callOf([{choices:[{delta:{tool_calls:[{index:0,id:'c1',type:'function',function:{name:'search',arguments:'{"query":"x"}'}}]},extra_content:{google:{thought_signature:'ON_CHOICE'}}}]}])).toMatchObject({signature:'ON_CHOICE'});
 // In a later chunk, after the call opened.
 expect(await callOf([{choices:[{delta:{tool_calls:[{index:0,id:'c2',type:'function',function:{name:'search',arguments:'{"query":"x"}'}}]}}]},{choices:[{delta:{extra_content:{google:{thought_signature:'LATER'}}},finish_reason:'tool_calls'}]}])).toMatchObject({signature:'LATER'});
 // A call saved before signatures were kept (the vlog's read_file) goes back with the placeholder instead of being refused.
 const old={model:'gemini-3.8-flash',system:'x',messages:[{role:'user',content:'q'},{role:'assistant',content:[{type:'tool_use',id:'old',name:'read_file',input:{path:'project.json'}}]},{role:'user',content:[{type:'tool_result',tool_use_id:'old',content:'{}'}]}]};
 expect(chatRequest(old,providerModels['gemini-3.8-flash'],1000).messages[2].tool_calls[0].extra_content).toEqual({google:{thought_signature:'skip_thought_signature_validator'}});
});

// Gemini's thinking is billed as output but left out of completion_tokens (only total_tokens has it): it went uncounted.
it('counts Gemini\'s thinking as output, from total_tokens',async()=>{
 vi.setSystemTime(new Date('2026-10-14T12:00:00Z'));
 const fetcher:typeof fetch=async()=>sse([{choices:[{index:0,delta:{role:'assistant',content:'Done'}}]},
  {choices:[{index:0,delta:{},finish_reason:'stop'}],usage:{prompt_tokens:900,completion_tokens:40,total_tokens:1940,prompt_tokens_details:{cached_tokens:0}}}]);
 const result=await handleAI({...conversation,model:'gemini-4-argon',requestId:'gem-think',max_tokens:2048},'user',{db,key:'anthropic',providerKeys:{google:'g-test'},fetcher});
 expect(result.body.usage.output_tokens).toBe(1040);expect(result.body.dream_request.costUsd).toBeCloseTo((900*2+1040*10)/1e6,9);
 vi.useRealTimers();
});

// Every other provider's model is billed the same by the gateway and the app: Gemini's announced increases from their
// dates, GPT-6 above 272K prompt tokens at its long-context rate, DeepSeek at half price off-peak.
it('bills other providers at the rate of the moment and the prompt size, the same in the gateway and the app',()=>{
 const small={input_tokens:100_000,cache_read_input_tokens:50_000,output_tokens:2_000},large={input_tokens:200_000,cache_read_input_tokens:100_000,output_tokens:2_000};
 const moments=[new Date('2026-10-14T02:00:00Z'),new Date('2026-10-14T12:00:00Z'),new Date('2026-10-17T02:00:00Z'),new Date('2026-12-02T12:00:00Z'),new Date('2027-01-02T12:00:00Z')];
 for(const model of Object.keys(providerModels))for(const at of moments)for(const usage of [small,large])expect(appCost(model,usage,undefined,at)).toBeCloseTo(usageCost(model,usage,[0,0],at),12);
 const million={input_tokens:1_000_000,cache_read_input_tokens:1_000_000,output_tokens:1_000_000};
 // DeepSeek: peak on a Wednesday at 02:00 UTC, half off at noon and on a Saturday.
 expect(usageCost('deepseek-flash',million,[0,0],new Date('2026-10-14T02:00:00Z'))).toBeCloseTo(.3+.006+1.2,9);
 expect(usageCost('deepseek-flash',million,[0,0],new Date('2026-10-14T12:00:00Z'))).toBeCloseTo((.3+.006+1.2)/2,9);
 expect(usageCost('deepseek-flash',million,[0,0],new Date('2026-10-17T02:00:00Z'))).toBeCloseTo((.3+.006+1.2)/2,9);
 // Gemini 4 Argon doubles on December 1; Gemini 3.8 Flash on January 1.
 expect(usageCost('gemini-4-argon',million,[0,0],new Date('2026-11-30T12:00:00Z'))).toBeCloseTo(2+.1+10,9);
 expect(usageCost('gemini-4-argon',million,[0,0],new Date('2026-12-01T12:00:00Z'))).toBeCloseTo(4+.2+20,9);
 expect(usageCost('gemini-3.8-flash',million,[0,0],new Date('2027-01-01T12:00:00Z'))).toBeCloseTo(1.5+.15+7.5,9);
 // GPT-6.1 Sol: 300K prompt tokens (uncached and cached) is past 272K.
 expect(usageCost('gpt-6.1-sol',large,[0,0])).toBeCloseTo((200_000*4+100_000*.2+2_000*15)/1e6,9);
 expect(usageCost('gpt-6.1-sol',small,[0,0])).toBeCloseTo((100_000*2+50_000*.1+2_000*10)/1e6,9);
});
