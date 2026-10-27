/** Models from other providers behind the same gateway. The app and the agent speak one format (Anthropic Messages, with
 * its streaming events); requests for these models are translated to OpenAI's Responses API or the Chat Completions API
 * (Gemini's OpenAI-compatible endpoint and DeepSeek), and their streams are translated back into the same events, so
 * accounting, receipts, recovery and the app work unchanged. DeepSeek can instead take the request almost as it is, on its
 * Anthropic-compatible Messages endpoint (messagesRequest). Prices are per million tokens (official pages, October 15,
 * 2026): GPT-6 above 272K prompt tokens at its long-context rate, Gemini's announced increases from their dates, DeepSeek
 * at half its peak rate off-peak. */
export type ProviderId='openai'|'google'|'deepseek'|'groq';
type Rates={price:[number,number];cachedRead:number};
export type ProviderModel=Rates&{provider:ProviderId;api:'responses'|'chat'|'messages';vision:boolean;reasoning:boolean;
 /** The provider's own name for the model, when it differs from the gateway's. */ remote?:string;
 /** A price change announced for a date. */ change?:Rates&{from:string};
 /** The rate for prompts (uncached and cached) above this many tokens. */ longContext?:Rates&{above:number};
 /** The share of the price charged outside the provider's peak hours. */ offPeak?:number};
export const providerModels:Record<string,ProviderModel>={
 'gpt-6-astra':{provider:'openai',api:'responses',price:[10,50],cachedRead:1,longContext:{above:272_000,price:[20,75],cachedRead:2},vision:true,reasoning:true},
 'gpt-6.1-sol':{provider:'openai',api:'responses',price:[2,10],cachedRead:.1,longContext:{above:272_000,price:[4,15],cachedRead:.2},vision:true,reasoning:true},
 // Terra (October 26, 2026): between Sol and Luna, made for computer use; Gumbo for Chrome's agent runs on it.
 'gpt-6.1-terra':{provider:'openai',api:'responses',price:[1,5],cachedRead:.05,vision:true,reasoning:true},
 'gpt-6-luna':{provider:'openai',api:'responses',price:[.1,.5],cachedRead:.01,longContext:{above:272_000,price:[.2,.75],cachedRead:.02},vision:true,reasoning:true},
 'gemini-4-argon':{provider:'google',api:'chat',price:[2,10],cachedRead:.1,change:{from:'2026-12-01T00:00:00Z',price:[4,20],cachedRead:.2},vision:true,reasoning:true},
 'gemini-3.8-flash':{provider:'google',api:'chat',price:[.75,3.75],cachedRead:.075,change:{from:'2027-01-01T00:00:00Z',price:[1.5,7.5],cachedRead:.15},vision:true,reasoning:true},
 'deepseek-flash':{provider:'deepseek',api:'chat',price:[.3,1.2],cachedRead:.006,offPeak:.5,vision:true,reasoning:false},
 // Groq's hosted Llama: the first word in a fraction of the time, for Tab when speed decides (Gumbo for Chrome).
 'groq-fast':{provider:'groq',api:'chat',remote:'llama-3.3-70b-versatile',price:[.59,.79],cachedRead:.59,vision:false,reasoning:false}
};
/** DeepSeek's peak hours: 01:00-04:00 and 06:00-10:00 UTC, Monday to Friday (its public holidays are not known here). */
const peak=(at:Date)=>{const day=at.getUTCDay(),hour=at.getUTCHours();return day>=1&&day<=5&&(hour>=1&&hour<4||hour>=6&&hour<10);};
/** What a call to one of these models is billed at, at a moment and for a prompt of a size. */
export function providerRates(model:ProviderModel,usage:Record<string,any>,at=new Date()):Rates{
 let rates:Rates=model.change&&at>=new Date(model.change.from)?model.change:model;
 if(model.longContext&&(usage.input_tokens??0)+(usage.cache_read_input_tokens??0)>model.longContext.above)rates=model.longContext;
 if(model.offPeak&&!peak(at))rates={price:[rates.price[0]*model.offPeak,rates.price[1]*model.offPeak],cachedRead:rates.cachedRead*model.offPeak};
 return rates;
}
export const providerSecrets:Record<ProviderId,string>={openai:'OPENAI_API_KEY',google:'GEMINI_API_KEY',deepseek:'DEEPSEEK_API_KEY',groq:'GROQ_API_KEY'};
export const providerNames:Record<ProviderId,string>={openai:'OpenAI',google:'Google Gemini',deepseek:'DeepSeek',groq:'Groq'};
export const providerEndpoints:Record<ProviderId,string>={openai:'https://api.openai.com/v1/responses',google:'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',deepseek:'https://api.deepseek.com/chat/completions',groq:'https://api.groq.com/openai/v1/chat/completions'};
/** DeepSeek's Anthropic-compatible Messages endpoint (https://api-docs.deepseek.com/guides/anthropic_api), the one its own
 * harness uses. Off unless the gateway's DEEPSEEK_ROUTE is 'messages': the chat route stays the default until the two
 * are compared on real edits. */
export const deepseekMessagesEndpoint='https://api.deepseek.com/anthropic/v1/messages';

/** Cost of a call to one of these models, from usage already in Anthropic's shape (uncached input, cache reads, output). */
export function providerCost(model:ProviderModel,usage:Record<string,any>,at=new Date()){const {price,cachedRead}=providerRates(model,usage,at);return((usage.input_tokens??0)*price[0]+(usage.cache_read_input_tokens??0)*cachedRead+(usage.output_tokens??0)*price[1])/1e6;}

const systemText=(system:unknown)=>typeof system==='string'?system:Array.isArray(system)?system.filter((b:any)=>b?.type==='text').map((b:any)=>b.text).join('\n\n'):'';
const dataUrl=(b:any)=>b?.source?.type==='base64'?`data:${b.source.media_type};base64,${b.source.data}`:b?.source?.type==='url'?b.source.url:undefined;
const noVision='[An image was here; this model cannot see images.]';
/** The conversation as Anthropic takes it: a signature on a tool call (Gemini's, kept for Gemini) is not one of its fields. */
export const anthropicMessages=(messages:any[])=>messages.map(m=>Array.isArray(m?.content)&&m.content.some((b:any)=>b?.type==='tool_use'&&'signature' in b)?{...m,content:m.content.map((b:any)=>{if(b?.type!=='tool_use'||!('signature' in b))return b;const {signature:_signature,...rest}=b;return rest;})}:m);
/** Custom tools as plain functions; Anthropic's own server tools (web search) have no equivalent and are left out. */
export function functionTools(tools:unknown){return(Array.isArray(tools)?tools:[]).filter((t:any)=>t&&typeof t.name==='string'&&(!t.type||t.type==='custom')).map((t:any)=>({name:t.name,description:t.description??'',parameters:t.input_schema??{type:'object',properties:{}}}));}
/** A tool result's text, with any images it carried returned separately (both APIs take images only in user turns). */
function toolResult(block:any):{text:string;images:string[]}{
 const parts=typeof block.content==='string'?[{type:'text',text:block.content}]:Array.isArray(block.content)?block.content:[];
 const images:string[]=[],text=parts.map((p:any)=>{if(p?.type==='text')return p.text;if(p?.type==='image'){const url=dataUrl(p);if(url)images.push(url);return '[image attached below]';}return '';}).filter(Boolean).join('\n');
 return{text:(block.is_error?'Error: ':'')+(text||'(no output)'),images};
}
const effortOf=(body:any)=>{const e=body.profile?.effort;return e==='low'||e==='medium'||e==='high'||e==='xhigh'?e:undefined;};
// DeepSeek thinks at high effort on every call unless told otherwise (its levels are low, high and max), which made
// routine edits several times slower than on GPT-6.1 Sol. Gumbo's effort for the request sets it: low and medium think
// lightly, high fully, xhigh at most.
const deepseekEffort=(effort:string)=>effort==='xhigh'?'max':effort==='high'?'high':'low';
/** Thinking on DeepSeek. Roux 1's requests spent most of their time in it: requests the router scored hard ran at high
 * effort, where one step thought for 5,000-9,000 tokens (30-50 s) before a small tool call. Replaying the slow steps of a
 * real request (October 24): at high effort the step that writes the edit thought for 47 s and still went on looking; at
 * low effort it wrote the same edit in 6 s; with thinking off it answered in 2 s but read more files instead; a cap
 * (budget_tokens) made it think more, not less. So by default ('auto') it thinks at low effort, and at high only for an
 * xhigh request (one the user asks to think hardest). dream_thinking 'off', or a number of tokens, sets it for one
 * request; the gateway's DREAM_DEEPSEEK_THINKING sets the default without a deploy: auto, on (thinking at the request's
 * own effort, as before) or off. */
export function deepseekThinking(body:any,mode:string='auto'){
 if(body?.dream_thinking==='off'||mode==='off'&&body?.dream_thinking===undefined)return{type:'disabled'};
 if(typeof body?.dream_thinking==='number'&&body.dream_thinking>=1024)return{type:'enabled',budget_tokens:Math.min(32_000,Math.round(body.dream_thinking))};
 return{type:'enabled'};
}
/** The effort DeepSeek thinks at: the request's own with the gateway's setting 'on', low otherwise unless asked for xhigh. */
const deepseekEffortFor=(effort:string|undefined,mode:string)=>!effort?undefined:mode==='on'?deepseekEffort(effort):effort==='xhigh'?'high':'low';

/** An Anthropic Messages request as a Chat Completions request (Gemini, DeepSeek). */
export function chatRequest(body:any,model:ProviderModel,maxTokens:number,thinkingMode='auto'){
 const messages:any[]=[],system=systemText(body.system);if(system)messages.push({role:'system',content:system});
 for(const m of body.messages as any[]){
  if(typeof m.content==='string'){messages.push({role:m.role,content:m.content});continue;}
  const blocks:any[]=Array.isArray(m.content)?m.content:[];
  if(m.role==='assistant'){
   const text=blocks.filter(b=>b.type==='text').map(b=>b.text).join(''),calls=blocks.filter(b=>b.type==='tool_use').map(b=>({id:b.id,type:'function',function:{name:b.name,arguments:JSON.stringify(b.input??{})},
    // Gemini 3 signs each function call and refuses the next request (400) unless the signature comes back with it. A
    // call made without one (by another model, or before signatures were kept) carries Google's documented placeholder.
    ...(model.provider==='google'?{extra_content:{google:{thought_signature:typeof b.signature==='string'&&b.signature?b.signature:'skip_thought_signature_validator'}}}:{})}));
   if(text||calls.length)messages.push({role:'assistant',content:text||null,...(calls.length?{tool_calls:calls}:{})});continue;
  }
  const parts:any[]=[],images:string[]=[];
  for(const b of blocks){
   if(b.type==='tool_result'){const r=toolResult(b);messages.push({role:'tool',tool_call_id:b.tool_use_id,content:r.text});images.push(...r.images);}
   else if(b.type==='text')parts.push({type:'text',text:b.text});
   else if(b.type==='image'){const url=dataUrl(b);parts.push(model.vision&&url?{type:'image_url',image_url:{url}}:{type:'text',text:noVision});}
   else if(b.type==='document')parts.push({type:'text',text:'[A document was attached here; this model cannot read it.]'});
   // Sound to listen to: Gemini hears it (input_audio); other models are told it was there.
   else if(b.type==='audio')parts.push(model.provider==='google'&&b.source?.data?{type:'input_audio',input_audio:{data:b.source.data,format:b.source.media_type==='audio/wav'?'wav':'mp3'}}:{type:'text',text:'[Audio was attached here; this model cannot hear it.]'});
  }
  if(images.length)parts.unshift({type:'text',text:'Images returned by the tools above:'},...images.map(url=>model.vision?{type:'image_url',image_url:{url}}:{type:'text',text:noVision}));
  if(parts.length)messages.push({role:'user',content:parts.every(p=>p.type==='text')?parts.map(p=>p.text).join('\n\n'):parts});
 }
 const tools=functionTools(body.tools),effort=effortOf(body);
 return{model:model.remote??body.model,messages,...(tools.length?{tools:tools.map(f=>({type:'function',function:f})),tool_choice:body.tool_choice?.type==='none'?'none':'auto'}:{}),max_tokens:maxTokens,stream:true,stream_options:{include_usage:true},
  ...(model.provider==='google'&&model.reasoning&&effort?{reasoning_effort:effort==='xhigh'?'high':effort}:{}),
  // DeepSeek's thinking as on its Messages route (deepseekThinking): its effort only matters while it thinks.
  // Thinking on is the request as it always was (its effort only); off adds the switch.
  ...(model.provider==='deepseek'?(()=>{const thinking=deepseekThinking(body,thinkingMode);return thinking.type==='disabled'?{thinking}:effort?{reasoning_effort:deepseekEffortFor(effort,thinkingMode)}:{};})():{})};
}

const unreadable:Record<string,string>={document:'[A document was attached here; this model cannot read it.]',audio:'[Audio was attached here; this model cannot hear it.]'};
/** An Anthropic Messages request as DeepSeek's Messages endpoint takes it. Thinking is on, at the request's effort, and
 * earlier thinking goes back with its signature as it came, so each step continues the model's own reasoning instead of
 * starting again (the engine sends only thinking this model wrote). Pictures go inline, in tool results too. What the
 * endpoint cannot take becomes a note (documents, sound) or is left out (redacted thinking, Anthropic's own server tools
 * and their results, Gemini's call signatures, cache_control, which it ignores). DeepSeek ignores is_error, so a failed
 * call says so in its text, as on the chat route. */
export function messagesRequest(body:any,model:ProviderModel,maxTokens:number,thinkingMode='auto'){
 // Without thinking this turn, earlier thinking stays out of what is sent (a request whose effort stepped down has some).
 const thinking=deepseekThinking(body,thinkingMode),thinks=thinking.type==='enabled';
 const input=(b:any):any[]=>b?.type==='text'?(b.text?[{type:'text',text:b.text}]:[]):
  b?.type==='image'?(model.vision&&(b.source?.type==='base64'||b.source?.type==='url')?[{type:'image',source:b.source}]:[{type:'text',text:noVision}]):
  unreadable[b?.type]?[{type:'text',text:unreadable[b.type]}]:[];
 const result=(b:any)=>{const content=(typeof b.content==='string'?[{type:'text',text:b.content}]:Array.isArray(b.content)?b.content:[]).flatMap(input);
  return{type:'tool_result',tool_use_id:b.tool_use_id,content:b.is_error?[{type:'text',text:'Error:'},...content]:content.length?content:[{type:'text',text:'(no output)'}]};};
 const said=(b:any):any[]=>b?.type==='text'?(b.text?[{type:'text',text:b.text}]:[]):
  b?.type==='thinking'&&thinks&&(b.thinking||b.signature)?[{type:'thinking',thinking:b.thinking??'',...(b.signature?{signature:b.signature}:{})}]:
  b?.type==='tool_use'?[{type:'tool_use',id:b.id,name:b.name,input:b.input??{}}]:[];
 const messages:{role:string;content:any[]}[]=[];
 for(const m of body.messages as any[]){
  const blocks=typeof m.content==='string'?[{type:'text',text:m.content}]:Array.isArray(m.content)?m.content:[];
  const content=m.role==='assistant'?blocks.flatMap(said):blocks.flatMap((b:any)=>b?.type==='tool_result'?[result(b)]:input(b));
  if(!content.length)continue;
  // Turns of one role in a row (notes after tool results, or a turn left empty above) are one turn, as Anthropic reads them.
  const last=messages.at(-1);if(last&&last.role===m.role)last.content.push(...content);else messages.push({role:m.role,content});
 }
 for(const m of messages)if(m.role==='user')m.content=[...m.content.filter(b=>b.type==='tool_result'),...m.content.filter(b=>b.type!=='tool_result')];
 const tools=functionTools(body.tools),effort=effortOf(body),system=systemText(body.system),choice=body.tool_choice?.type;
 return{model:body.model,max_tokens:maxTokens,stream:true,...(system?{system}:{}),messages,
  ...(tools.length?{tools:tools.map(t=>({name:t.name,description:t.description,input_schema:t.parameters})),...(choice==='none'||choice==='any'?{tool_choice:{type:choice}}:choice==='tool'&&body.tool_choice.name?{tool_choice:{type:'tool',name:body.tool_choice.name}}:{})}:{}),
  thinking,...(effort&&thinks?{output_config:{effort:deepseekEffortFor(effort,thinkingMode)}}:{})};
}
/** DeepSeek's usage on its Messages endpoint as the gateway bills it, from the largest of each count the stream reported
 * (message_start and message_delta). Input is every prompt token not read from the cache: DeepSeek bills a miss at the
 * input price and has no cache-write charge, so any tokens reported as cache writes are input. Its own hit and miss
 * counts, when it sends them, decide. */
export function messagesUsage(seen:Record<string,number>){
 const native=Number.isFinite(seen.prompt_cache_hit_tokens)&&Number.isFinite(seen.prompt_cache_miss_tokens);
 return{input_tokens:native?seen.prompt_cache_miss_tokens:(seen.input_tokens??0)+(seen.cache_creation_input_tokens??0),cache_read_input_tokens:native?seen.prompt_cache_hit_tokens:seen.cache_read_input_tokens??0,cache_creation_input_tokens:0,output_tokens:seen.output_tokens??0};
}

/** Two 32-bit FNV-1a hashes as 16 hex characters: enough to tell prompt prefixes apart in a cache key. */
const shortHash=(text:string)=>{let a=0x811c9dc5,b=0x01000193^0x9e3779b9;for(let i=0;i<text.length;i++){const c=text.charCodeAt(i);a=Math.imul(a^c,0x01000193)>>>0;b=Math.imul(b^c,0x01000193)>>>0;}return a.toString(16).padStart(8,'0')+b.toString(16).padStart(8,'0');};
/** OpenAI's cache key for a request: one per user and stable prompt start (the model, its instructions and tools), so a
 * new request, or a worker that shares the prompt, reads the system prompt and tools from the cache its earlier requests
 * wrote. It was the request id until October 18, so every request (and each worker) began cold: about 14k uncached
 * tokens on the first call of each. Without a user, the request id as before. */
export function promptCacheKey(body:any,user?:string){
 if(!user)return body.turnId?'gumbo-'+String(body.turnId).slice(0,56):undefined;
 return 'gumbo-'+shortHash(user)+'-'+shortHash(JSON.stringify([body.model,systemText(body.system),functionTools(body.tools)]));
}

/** An Anthropic Messages request as an OpenAI Responses request. Nothing is stored at OpenAI. */
export function responsesRequest(body:any,model:ProviderModel,maxTokens:number,user?:string){
 const input:any[]=[];
 for(const m of body.messages as any[]){
  if(typeof m.content==='string'){input.push(m.role==='assistant'?{role:'assistant',content:m.content}:{role:'user',content:[{type:'input_text',text:m.content}]});continue;}
  const blocks:any[]=Array.isArray(m.content)?m.content:[];
  if(m.role==='assistant'){
   const text=blocks.filter(b=>b.type==='text').map(b=>b.text).join('');if(text)input.push({role:'assistant',content:text});
   for(const b of blocks)if(b.type==='tool_use')input.push({type:'function_call',call_id:b.id,name:b.name,arguments:JSON.stringify(b.input??{})});continue;
  }
  const parts:any[]=[],images:string[]=[];
  for(const b of blocks){
   if(b.type==='tool_result'){const r=toolResult(b);input.push({type:'function_call_output',call_id:b.tool_use_id,output:r.text});images.push(...r.images);}
   else if(b.type==='text')parts.push({type:'input_text',text:b.text});
   else if(b.type==='image'){const url=dataUrl(b);parts.push(model.vision&&url?{type:'input_image',image_url:url}:{type:'input_text',text:noVision});}
   else if(b.type==='document')parts.push({type:'input_text',text:'[A document was attached here; this model cannot read it.]'});
  }
  if(images.length)parts.unshift({type:'input_text',text:'Images returned by the tools above:'},...images.map(url=>({type:'input_image',image_url:url})));
  if(parts.length)input.push({role:'user',content:parts});
 }
 const tools=functionTools(body.tools),effort=effortOf(body),instructions=systemText(body.system);
 return{model:body.model,...(instructions?{instructions}:{}),input,...(tools.length?{tools:tools.map(f=>({type:'function',...f,strict:false})),tool_choice:body.tool_choice?.type==='none'?'none':'auto'}:{}),max_output_tokens:maxTokens,stream:true,store:false,
  // Calls with the same user and prompt start share a cache key, so OpenAI routes them to the same cache: the growing
  // prefix of one request, and the system prompt and tools of the next, are read, not re-billed.
  ...(promptCacheKey(body,user)?{prompt_cache_key:promptCacheKey(body,user)}:{}),...(effort?{reasoning:{effort}}:{})};
}

/** Writes Anthropic streaming events: one text or tool_use block open at a time, then the stop reason and usage. */
class Events{
 private index=-1;private open:{kind:'text'|'tool';key?:string}|null=null;private started=false;private tools=0;
 constructor(private send:(event:string,data:unknown)=>void,private model:string,private id:string){}
 start(){if(this.started)return;this.started=true;this.send('message_start',{type:'message_start',message:{id:this.id,type:'message',role:'assistant',model:this.model,content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:0,output_tokens:0}}});}
 private close(){if(this.open){this.send('content_block_stop',{type:'content_block_stop',index:this.index});this.open=null;}}
 text(delta:string){if(!delta)return;this.start();if(this.open?.kind!=='text'){this.close();this.index++;this.open={kind:'text'};this.send('content_block_start',{type:'content_block_start',index:this.index,content_block:{type:'text',text:''}});}
  this.send('content_block_delta',{type:'content_block_delta',index:this.index,delta:{type:'text_delta',text:delta}});}
 tool(key:string,id:string,name:string){this.start();this.close();this.index++;this.tools++;this.open={kind:'tool',key};this.send('content_block_start',{type:'content_block_start',index:this.index,content_block:{type:'tool_use',id,name,input:{}}});}
 /** A tool call's signature (Gemini's thought_signature), kept on the call so it can be sent back with it. */
 signature(key:string,value:string){if(value&&this.open?.kind==='tool'&&this.open.key===key)this.send('content_block_delta',{type:'content_block_delta',index:this.index,delta:{type:'signature_delta',signature:value}});}
 args(key:string,partial:string){if(partial&&this.open?.kind==='tool'&&this.open.key===key)this.send('content_block_delta',{type:'content_block_delta',index:this.index,delta:{type:'input_json_delta',partial_json:partial}});}
 isOpenTool(key:string){return this.open?.kind==='tool'&&this.open.key===key;}
 /** usage.reasoning: the output tokens the model spent thinking, which OpenAI, Gemini and DeepSeek report and Anthropic's
  * shape has no field for; passed on as output_tokens_details.reasoning_tokens so logs show how much a call thought. */
 finish(stop:'end_turn'|'max_tokens'|'refusal'|'tool_use',usage:{input:number;cached:number;output:number;reasoning?:number}){
  this.start();this.close();
  this.send('message_delta',{type:'message_delta',delta:{stop_reason:this.tools&&stop==='end_turn'?'tool_use':stop,stop_sequence:null},usage:{input_tokens:Math.max(0,usage.input-usage.cached),cache_read_input_tokens:usage.cached,cache_creation_input_tokens:0,output_tokens:usage.output,...(usage.reasoning?{output_tokens_details:{reasoning_tokens:usage.reasoning}}:{})}});
  this.send('message_stop',{type:'message_stop'});
 }
 fail(message:string){this.send('error',{type:'error',error:{type:'provider_error',message}});}
}

/** Reads a provider's server-sent events: each record's event name (if any) and its parsed data; "[DONE]" ends it. */
async function* records(body:ReadableStream<Uint8Array>){
 const reader=body.getReader(),decoder=new TextDecoder();let buffer='';
 try{for(;;){const {done,value}=await reader.read();buffer+=done?decoder.decode():decoder.decode(value,{stream:true});
  let match:RegExpExecArray|null;
  while((match=/\r?\n\r?\n/.exec(buffer))){const record=buffer.slice(0,match.index);buffer=buffer.slice(match.index+match[0].length);let event='';const data:string[]=[];
   for(const line of record.split(/\r?\n/)){if(line.startsWith('event:'))event=line.slice(6).trim();else if(line.startsWith('data:'))data.push(line.slice(5).replace(/^ /,''));}
   const text=data.join('\n');if(!text)continue;if(text==='[DONE]')return;yield{event,data:JSON.parse(text)};}
  if(done)return;}}
 finally{reader.releaseLock();}
}

/** The thought_signature anywhere in a value (Gemini puts it in extra_content.google, on the call or around it). */
function thoughtSignature(value:unknown,depth=0):string|undefined{
 if(!value||typeof value!=='object'||depth>6)return undefined;
 for(const [key,item] of Object.entries(value as Record<string,unknown>)){if((key==='thought_signature'||key==='thoughtSignature')&&typeof item==='string'&&item)return item;const found=thoughtSignature(item,depth+1);if(found)return found;}
 return undefined;
}
/** A provider's stream as an Anthropic event stream (a Response, so the gateway's streaming and accounting take it as is). */
export function anthropicStream(response:Response,model:ProviderModel,modelId:string,requestId:string):Response{
 const encoder=new TextEncoder();
 const stream=new ReadableStream<Uint8Array>({async start(controller){
  const send=(event:string,data:unknown)=>controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)),out=new Events(send,modelId,'msg_'+requestId.replace(/[^\w-]/g,'').slice(0,40));
  try{
   if(!response.body)throw new Error('The provider sent no stream.');
   if(model.api==='messages'){
    // Already Anthropic events: passed on as they come, with usage in the shape the gateway bills.
    const seen:Record<string,number>={},note=(usage:any)=>{for(const [key,value] of Object.entries(usage??{}))if(typeof value==='number'&&Number.isFinite(value))seen[key]=Math.max(seen[key]??0,value);};
    let stopped=false;
    for await(const {event,data} of records(response.body)){
     const type=data?.type??event;
     if(type==='error')throw new Error(data.error?.message??'The provider reported an error.');
     if(type==='message_start'){note(data.message?.usage);send(type,{...data,message:{...data.message,usage:messagesUsage(seen)}});}
     else if(type==='message_delta'){note(data.usage);send(type,{...data,usage:messagesUsage(seen)});}
     else{if(type==='message_stop')stopped=true;send(type,data);}
    }
    if(!stopped)throw new Error('The provider stream ended before the response finished.');
   }else if(model.api==='chat'){
    let stop:'end_turn'|'max_tokens'|'refusal'='end_turn',usage:{input:number;cached:number;output:number;reasoning?:number}={input:0,cached:0,output:0};const toolIds=new Map<number,string>();let pending:string|undefined,lastTool:string|undefined;
    for await(const {data} of records(response.body)){
     if(data.error)throw new Error(data.error.message??'The provider reported an error.');out.start();
     const choice=data.choices?.[0],delta=choice?.delta??{};
     if(typeof delta.content==='string')out.text(delta.content);
     // Gemini's signature for a function call may come on the call, on the delta or on the choice: wherever it is in the
     // chunk, it belongs to the call in that chunk, or to the next call when it comes first.
     const signed=thoughtSignature(data);if(signed)pending=signed;
     for(const call of delta.tool_calls??[]){const n=Number(call.index??0);
      if(!toolIds.has(n)||call.id&&call.id!==toolIds.get(n)){const id=call.id??`call_${n}_${toolIds.size}`;toolIds.set(n,id);out.tool(id,id,call.function?.name??'tool');}
      out.args(toolIds.get(n)!,call.function?.arguments??'');const own=thoughtSignature(call)??pending;if(own){out.signature(toolIds.get(n)!,own);pending=undefined;}lastTool=toolIds.get(n);}
     if(pending&&lastTool&&!(delta.tool_calls??[]).length){out.signature(lastTool,pending);pending=undefined;}
     if(choice?.finish_reason)stop=choice.finish_reason==='length'?'max_tokens':choice.finish_reason==='content_filter'?'refusal':'end_turn';
     // Gemini leaves its thinking out of completion_tokens (only total_tokens has it) but bills it as output, so output
     // is whichever is larger: the completion, or everything after the prompt.
     if(data.usage){const u=data.usage,cached=u.prompt_tokens_details?.cached_tokens??u.prompt_cache_hit_tokens??0;usage={input:u.prompt_tokens??0,cached,output:Math.max(u.completion_tokens??0,(u.total_tokens??0)-(u.prompt_tokens??0)),reasoning:u.completion_tokens_details?.reasoning_tokens??0};}
    }
    out.finish(stop,usage);
   }else{
    let finished=false;const streamed=new Set<string>();
    for await(const {event,data} of records(response.body)){
     const type=data.type??event;out.start();
     if(type==='response.output_item.added'&&data.item?.type==='function_call')out.tool(data.item.id??data.item.call_id,data.item.call_id,data.item.name);
     else if(type==='response.output_text.delta')out.text(data.delta??'');
     else if(type==='response.function_call_arguments.delta'){streamed.add(data.item_id);out.args(data.item_id,data.delta??'');}
     else if(type==='response.function_call_arguments.done'&&!streamed.has(data.item_id))out.args(data.item_id,data.arguments??'');
     else if(type==='response.output_item.done'&&data.item?.type==='function_call'&&!streamed.has(data.item.id)&&out.isOpenTool(data.item.id)&&data.item.arguments){streamed.add(data.item.id);out.args(data.item.id,data.item.arguments);}
     else if(type==='response.completed'||type==='response.incomplete'){const r=data.response??{},u=r.usage??{};finished=true;
      out.finish(r.incomplete_details?.reason==='max_output_tokens'?'max_tokens':r.incomplete_details?.reason==='content_filter'?'refusal':'end_turn',{input:u.input_tokens??0,cached:u.input_tokens_details?.cached_tokens??0,output:u.output_tokens??0,reasoning:u.output_tokens_details?.reasoning_tokens??0});}
     else if(type==='response.failed'||type==='error')throw new Error(data.response?.error?.message??data.error?.message??data.message??'The provider reported an error.');
    }
    if(!finished)throw new Error('The provider stream ended before the response finished.');
   }
  }catch(error){out.fail((error as Error).message);}
  finally{controller.close();}
 }});
 return new Response(stream,{status:200,headers:{'content-type':'text/event-stream','request-id':response.headers.get('x-request-id')??response.headers.get('request-id')??''}});
}
