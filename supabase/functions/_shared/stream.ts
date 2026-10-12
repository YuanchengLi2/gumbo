export type StreamEvent={event:string;data:any};
export class SSEDecoder {
 private decoder=new TextDecoder();private buffer='';
 push(chunk?:Uint8Array):StreamEvent[]{
  this.buffer+=chunk?this.decoder.decode(chunk,{stream:true}):this.decoder.decode();
  const events:StreamEvent[]=[];let match:RegExpExecArray|null;
  while((match=/\r?\n\r?\n/.exec(this.buffer))){
   const record=this.buffer.slice(0,match.index);this.buffer=this.buffer.slice(match.index+match[0].length);
   let event='message';const data:string[]=[];
   for(const line of record.split(/\r?\n/)){if(line.startsWith('event:'))event=line.slice(6).trimStart();else if(line.startsWith('data:'))data.push(line.slice(5).replace(/^ /,''));}
   if(data.length){const text=data.join('\n');let parsed:any;try{parsed=JSON.parse(text);}catch{throw Object.assign(new Error('The AI stream sent an event that is not JSON.'),{code:'invalid_stream',diagnostics:{event,snippet:text.slice(0,300)},events});}events.push({event,data:parsed});}
  }
  if(this.buffer.length>4_000_000)throw new Error('The AI event exceeded the supported event size.');
  return events;
 }
}

export class MessageAssembler {
 message:any;done=false;error:any;receipt:any;policy:any;
 constructor(private maxTokens?:number){}
 diagnostics(){return{stopReason:this.message?.stop_reason,outputTokens:this.message?.usage?.output_tokens,maxTokens:this.maxTokens,openBlocks:[...this.open],invalidJSON:this.invalidJSON,terminal:this.done,blocks:(this.message?.content??[]).map((b:any)=>b?.type),recent:[...this.trail]};}
 private trail:string[]=[];
 private open=new Set<number>();private json=new Map<number,string>();private invalidJSON=false;
 accept({event,data}:StreamEvent){
  this.trail.push(event==='message'||event===data?.type?String(data?.type??event):`${event}:${data?.type??''}`);if(this.trail.length>20)this.trail.shift();
  if(event==='dream_policy'){this.policy=data;if(Number.isFinite(data.maxTokens))this.maxTokens=data.maxTokens;return;}
  if(event==='dream_request'){this.receipt=data;return;}
  if(data.type==='error'){this.error=data.error;return;}
  if(data.type==='message_start'){
   if(this.message)throw new Error('Duplicate AI message start.');
   this.message={...data.message,content:[...(data.message.content??[])],usage:{...data.message.usage}};return;
  }
  if(!this.message)return;
  if(data.type?.startsWith('content_block_')&&(!Number.isInteger(data.index)||data.index<0||data.index>1023))throw new Error('Invalid AI block index.');
  if(data.type==='content_block_start'){
   if(this.done||this.message.content[data.index])throw new Error('Invalid AI block sequence.');
   this.message.content[data.index]=structuredClone(data.content_block);this.open.add(data.index);
  }else if(data.type==='content_block_delta'){
   const block=this.message.content[data.index],delta=data.delta;if(!block||!this.open.has(data.index))throw new Error('AI delta has no open block.');
   if(delta.type==='text_delta')block.text=(block.text??'')+delta.text;
   else if(delta.type==='thinking_delta')block.thinking=(block.thinking??'')+delta.thinking;
   else if(delta.type==='signature_delta')block.signature=(block.signature??'')+delta.signature;
   else if(delta.type==='input_json_delta')this.json.set(data.index,(this.json.get(data.index)??'')+delta.partial_json);
   else if(delta.type==='citations_delta')(block.citations??=[]).push(delta.citation);
  }else if(data.type==='content_block_stop'){
   if(!this.open.delete(data.index))throw new Error('AI block ended without a start.');
   const json=this.json.get(data.index);if(json!==undefined&&json.trim()!==''){try{this.message.content[data.index].input=JSON.parse(json);}catch{this.invalidJSON=true;}}
  }else if(data.type==='message_delta'){
   Object.assign(this.message,data.delta??{});Object.assign(this.message.usage,data.usage??{});
  }else if(data.type==='message_stop'){
   const incomplete=this.open.size>0||!this.message.stop_reason||this.invalidJSON;
   const limit=this.message.stop_reason==='max_tokens';
   if(incomplete&&limit){this.message.dream_truncation=this.diagnostics();this.message.stop_reason='max_tokens';}
   else if(incomplete)throw Object.assign(new Error('The AI message ended with incomplete content.'),{code:'invalid_stream',diagnostics:this.diagnostics()});
   this.done=true;
  }
 }
 result(){
  if(!this.done||this.error)throw Object.assign(new Error(this.error?.message??'The AI stream ended before the message finished.'),{code:this.error?.type??'transport_loss',diagnostics:{...this.diagnostics(),providerRequestId:this.receipt?.providerRequestId}});
  return{...this.message,dream_request:this.receipt,dream_policy:this.policy};
 }
}

export async function readMessageStream(response:Response,onEvent?:(event:StreamEvent)=>void){
 if(!response.body)throw new Error('The AI stream has no body.');
 const reader=response.body.getReader(),decoder=new SSEDecoder(),assembler=new MessageAssembler();
 const accept=(event:StreamEvent)=>{assembler.accept(event);onEvent?.(event);};
 try{for(;;){const {done,value}=await reader.read();if(done)break;for(const event of decoder.push(value))accept(event);}for(const event of decoder.push())accept(event);return assembler.result();}
 catch(error){
  // Events decoded in the same chunk before a bad one still count toward what the stream showed.
  for(const event of (error as any)?.events??[])try{accept(event);}catch{}
  if(assembler.done&&!assembler.error)return assembler.result();if(error&&typeof error==='object'){delete (error as any).events;}if(error&&typeof error==='object')(error as any).diagnostics={...assembler.diagnostics(),...(error as any).diagnostics};throw error;}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
}
