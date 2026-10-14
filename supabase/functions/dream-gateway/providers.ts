/** Models from other providers behind the same gateway. The app and the agent speak one format (Anthropic Messages, with
 * its streaming events); requests for these models are translated to OpenAI's Responses API or the Chat Completions API
 * (Gemini's OpenAI-compatible endpoint and DeepSeek), and their streams are translated back into the same events, so
 * accounting, receipts, recovery and the app work unchanged. Prices are per million tokens (official pages, October 13,
 * 2026; DeepSeek at its peak rate, Gemini 4 Argon before its December 1 increase). */
export type ProviderId='openai'|'google'|'deepseek';
export type ProviderModel={provider:ProviderId;api:'responses'|'chat';price:[number,number];cachedRead:number;vision:boolean;reasoning:boolean};
export const providerModels:Record<string,ProviderModel>={
 'gpt-6-astra':{provider:'openai',api:'responses',price:[10,50],cachedRead:1,vision:true,reasoning:true},
 'gpt-6.1-sol':{provider:'openai',api:'responses',price:[2,10],cachedRead:.1,vision:true,reasoning:true},
 'gpt-6-luna':{provider:'openai',api:'responses',price:[.1,.5],cachedRead:.01,vision:true,reasoning:true},
 'gemini-4-argon':{provider:'google',api:'chat',price:[2,10],cachedRead:.1,vision:true,reasoning:true},
 'gemini-3.8-flash':{provider:'google',api:'chat',price:[.75,3.75],cachedRead:.075,vision:true,reasoning:true},
 'deepseek-flash':{provider:'deepseek',api:'chat',price:[.3,1.2],cachedRead:.006,vision:true,reasoning:false}
};
export const providerSecrets:Record<ProviderId,string>={openai:'OPENAI_API_KEY',google:'GEMINI_API_KEY',deepseek:'DEEPSEEK_API_KEY'};
export const providerNames:Record<ProviderId,string>={openai:'OpenAI',google:'Google Gemini',deepseek:'DeepSeek'};
export const providerEndpoints:Record<ProviderId,string>={openai:'https://api.openai.com/v1/responses',google:'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions',deepseek:'https://api.deepseek.com/chat/completions'};

/** Cost of a call to one of these models, from usage already in Anthropic's shape (uncached input, cache reads, output). */
export function providerCost(model:ProviderModel,usage:Record<string,any>){return((usage.input_tokens??0)*model.price[0]+(usage.cache_read_input_tokens??0)*model.cachedRead+(usage.output_tokens??0)*model.price[1])/1e6;}

const systemText=(system:unknown)=>typeof system==='string'?system:Array.isArray(system)?system.filter((b:any)=>b?.type==='text').map((b:any)=>b.text).join('\n\n'):'';
const dataUrl=(b:any)=>b?.source?.type==='base64'?`data:${b.source.media_type};base64,${b.source.data}`:b?.source?.type==='url'?b.source.url:undefined;
const noVision='[An image was here; this model cannot see images.]';
/** Custom tools as plain functions; Anthropic's own server tools (web search) have no equivalent and are left out. */
export function functionTools(tools:unknown){return(Array.isArray(tools)?tools:[]).filter((t:any)=>t&&typeof t.name==='string'&&(!t.type||t.type==='custom')).map((t:any)=>({name:t.name,description:t.description??'',parameters:t.input_schema??{type:'object',properties:{}}}));}
/** A tool result's text, with any images it carried returned separately (both APIs take images only in user turns). */
function toolResult(block:any):{text:string;images:string[]}{
 const parts=typeof block.content==='string'?[{type:'text',text:block.content}]:Array.isArray(block.content)?block.content:[];
 const images:string[]=[],text=parts.map((p:any)=>{if(p?.type==='text')return p.text;if(p?.type==='image'){const url=dataUrl(p);if(url)images.push(url);return '[image attached below]';}return '';}).filter(Boolean).join('\n');
 return{text:(block.is_error?'Error: ':'')+(text||'(no output)'),images};
}
const effortOf=(body:any)=>{const e=body.profile?.effort;return e==='low'||e==='medium'||e==='high'||e==='xhigh'?e:undefined;};

/** An Anthropic Messages request as a Chat Completions request (Gemini, DeepSeek). */
export function chatRequest(body:any,model:ProviderModel,maxTokens:number){
 const messages:any[]=[],system=systemText(body.system);if(system)messages.push({role:'system',content:system});
 for(const m of body.messages as any[]){
  if(typeof m.content==='string'){messages.push({role:m.role,content:m.content});continue;}
  const blocks:any[]=Array.isArray(m.content)?m.content:[];
  if(m.role==='assistant'){
   const text=blocks.filter(b=>b.type==='text').map(b=>b.text).join(''),calls=blocks.filter(b=>b.type==='tool_use').map(b=>({id:b.id,type:'function',function:{name:b.name,arguments:JSON.stringify(b.input??{})}}));
   if(text||calls.length)messages.push({role:'assistant',content:text||null,...(calls.length?{tool_calls:calls}:{})});continue;
  }
  const parts:any[]=[],images:string[]=[];
  for(const b of blocks){
   if(b.type==='tool_result'){const r=toolResult(b);messages.push({role:'tool',tool_call_id:b.tool_use_id,content:r.text});images.push(...r.images);}
   else if(b.type==='text')parts.push({type:'text',text:b.text});
   else if(b.type==='image'){const url=dataUrl(b);parts.push(model.vision&&url?{type:'image_url',image_url:{url}}:{type:'text',text:noVision});}
   else if(b.type==='document')parts.push({type:'text',text:'[A document was attached here; this model cannot read it.]'});
  }
  if(images.length)parts.unshift({type:'text',text:'Images returned by the tools above:'},...images.map(url=>model.vision?{type:'image_url',image_url:{url}}:{type:'text',text:noVision}));
  if(parts.length)messages.push({role:'user',content:parts.every(p=>p.type==='text')?parts.map(p=>p.text).join('\n\n'):parts});
 }
 const tools=functionTools(body.tools),effort=effortOf(body);
 return{model:body.model,messages,...(tools.length?{tools:tools.map(f=>({type:'function',function:f})),tool_choice:body.tool_choice?.type==='none'?'none':'auto'}:{}),max_tokens:maxTokens,stream:true,stream_options:{include_usage:true},
  ...(model.provider==='google'&&model.reasoning&&effort?{reasoning_effort:effort==='xhigh'?'high':effort}:{})};
}

/** An Anthropic Messages request as an OpenAI Responses request. Nothing is stored at OpenAI. */
export function responsesRequest(body:any,model:ProviderModel,maxTokens:number){
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
  // Every call of one request shares a cache key, so OpenAI routes them to the same cache and the growing prefix is read, not re-billed.
  ...(body.turnId?{prompt_cache_key:'figjam-'+String(body.turnId).slice(0,56)}:{}),...(effort?{reasoning:{effort}}:{})};
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
 args(key:string,partial:string){if(partial&&this.open?.kind==='tool'&&this.open.key===key)this.send('content_block_delta',{type:'content_block_delta',index:this.index,delta:{type:'input_json_delta',partial_json:partial}});}
 isOpenTool(key:string){return this.open?.kind==='tool'&&this.open.key===key;}
 finish(stop:'end_turn'|'max_tokens'|'refusal'|'tool_use',usage:{input:number;cached:number;output:number}){
  this.start();this.close();
  this.send('message_delta',{type:'message_delta',delta:{stop_reason:this.tools&&stop==='end_turn'?'tool_use':stop,stop_sequence:null},usage:{input_tokens:Math.max(0,usage.input-usage.cached),cache_read_input_tokens:usage.cached,cache_creation_input_tokens:0,output_tokens:usage.output}});
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

/** A provider's stream as an Anthropic event stream (a Response, so the gateway's streaming and accounting take it as is). */
export function anthropicStream(response:Response,model:ProviderModel,modelId:string,requestId:string):Response{
 const encoder=new TextEncoder();
 const stream=new ReadableStream<Uint8Array>({async start(controller){
  const send=(event:string,data:unknown)=>controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)),out=new Events(send,modelId,'msg_'+requestId.replace(/[^\w-]/g,'').slice(0,40));
  try{
   if(!response.body)throw new Error('The provider sent no stream.');
   if(model.api==='chat'){
    let stop:'end_turn'|'max_tokens'|'refusal'='end_turn',usage={input:0,cached:0,output:0};const toolIds=new Map<number,string>();
    for await(const {data} of records(response.body)){
     if(data.error)throw new Error(data.error.message??'The provider reported an error.');out.start();
     const choice=data.choices?.[0],delta=choice?.delta??{};
     if(typeof delta.content==='string')out.text(delta.content);
     for(const call of delta.tool_calls??[]){const n=Number(call.index??0);
      if(!toolIds.has(n)||call.id&&call.id!==toolIds.get(n)){const id=call.id??`call_${n}_${toolIds.size}`;toolIds.set(n,id);out.tool(id,id,call.function?.name??'tool');}
      out.args(toolIds.get(n)!,call.function?.arguments??'');}
     if(choice?.finish_reason)stop=choice.finish_reason==='length'?'max_tokens':choice.finish_reason==='content_filter'?'refusal':'end_turn';
     if(data.usage){const u=data.usage,cached=u.prompt_tokens_details?.cached_tokens??u.prompt_cache_hit_tokens??0;usage={input:u.prompt_tokens??0,cached,output:u.completion_tokens??0};}
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
      out.finish(r.incomplete_details?.reason==='max_output_tokens'?'max_tokens':r.incomplete_details?.reason==='content_filter'?'refusal':'end_turn',{input:u.input_tokens??0,cached:u.input_tokens_details?.cached_tokens??0,output:u.output_tokens??0});}
     else if(type==='response.failed'||type==='error')throw new Error(data.response?.error?.message??data.error?.message??data.message??'The provider reported an error.');
    }
    if(!finished)throw new Error('The provider stream ended before the response finished.');
   }
  }catch(error){out.fail((error as Error).message);}
  finally{controller.close();}
 }});
 return new Response(stream,{status:200,headers:{'content-type':'text/event-stream','request-id':response.headers.get('x-request-id')??response.headers.get('request-id')??''}});
}
