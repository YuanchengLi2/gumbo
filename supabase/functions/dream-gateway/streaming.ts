import {SSEDecoder,MessageAssembler} from '../_shared/stream.ts';
import {usageCost,pricingVersion} from './inference-policy.ts';
import type {RequestStore} from './inference-requests.ts';
export function streamProvider(response:Response,options:{db:any;usageId:string;model:string;price:[number,number];abort:AbortController;effectivePolicy?:unknown;requests?:RequestStore;userId?:string;requestId?:string;idleMs?:number;maxTokens?:number;features?:string[]}){
 const {db,usageId,model,price,abort,requests,userId,requestId}=options,providerRequestId=response.headers.get('request-id')??undefined;
 const decoder=new SSEDecoder(),assembler=new MessageAssembler(options.maxTokens),encoder=new TextEncoder();let detached=false,settled=false,controller:ReadableStreamDefaultController<Uint8Array>;
 let reader:ReadableStreamDefaultReader<Uint8Array>|undefined,lastActivity=Date.now(),checking=false;
 let finish!:()=>void;const finished=new Promise<void>(resolve=>finish=resolve);
 const emit=(event:string,data:any)=>{if(!detached)try{controller.enqueue(encoder.encode('event: '+event+'\ndata: '+JSON.stringify(data)+'\n\n'));}catch{detached=true;}};
 const settle=async(status:string,errorCode?:string)=>{
  if(settled)return false;settled=true;const usage=assembler.message?.usage??{};
  try{const {error}=await db.from('dream_usage').update({status,provider_request_id:providerRequestId,provider_status:response.status,error_code:errorCode??null,input_tokens:usage.input_tokens??0,output_tokens:usage.output_tokens??0,cache_read_tokens:usage.cache_read_input_tokens??0,cache_write_tokens:usage.cache_creation_input_tokens??0,cost_usd:usageCost(model,usage,price)}).eq('id',usageId);return!!error;}catch{return true;}
 };
 const policy={pricingVersion,thinkingDisplay:(options.effectivePolicy as any)?.thinking?.display??'omitted',maxTokens:options.maxTokens,features:options.features??[]};
 const pump=async()=>{
  emit('dream_policy',policy);
  const heartbeat=setInterval(()=>{
   emit('ping',{type:'ping'});
   if(Date.now()-lastActivity>(options.idleMs??60_000))abort.abort(new Error('The AI provider stopped sending data.'));
   if(requests&&!checking){checking=true;void requests.read(userId!,requestId!).then(record=>{if(record?.status==='cancelled')abort.abort(new Error('Stopped by you.'));}).catch(()=>{}).finally(()=>checking=false);}
  },5_000);
  const complete=async()=>{
   if(requests&&(await requests.read(userId!,requestId!))?.status==='cancelled')throw new Error('Stopped by you.');
   const result=assembler.result(),receipt={status:'completed',retryable:false,providerRequestId,accountingPending:await settle('completed'),effectivePolicy:options.effectivePolicy,diagnostics:assembler.diagnostics(),outcome:assembler.message?.stop_reason==='max_tokens'?'truncated':'completed',costUsd:usageCost(model,assembler.message?.usage??{},price)};
   await requests?.finish(userId!,requestId!,'completed',{...result,dream_policy:policy,dream_request:receipt});emit('dream_request',receipt);
  };
  try{
   if(!response.body)throw new Error('Missing provider stream.');reader=response.body.getReader();
   for(;;){const {done,value}=await reader.read();if(done)break;lastActivity=Date.now();for(const event of decoder.push(value)){assembler.accept(event);emit(event.event,event.data);}}
   for(const event of decoder.push()){assembler.accept(event);emit(event.event,event.data);}await complete();
  }catch(error){
   if(assembler.done&&!assembler.error&&!abort.signal.aborted){try{await complete();}catch{emit('dream_request',{status:'uncertain',providerRequestId});}}
   else{const code=(error as any).code??assembler.error?.type??'transport_loss',status=code==='invalid_stream'?'failed':'uncertain';await settle(status,code);await requests?.finish(userId!,requestId!,status,undefined,JSON.stringify({message:(error as Error).message,stream:assembler.diagnostics()})).catch(()=>{});emit('dream_request',{status:'uncertain',retryable:false,providerRequestId});emit('error',{type:'error',error:{type:(error as any).code??assembler.error?.type??'transport_loss',message:assembler.error?.message??(error as Error).message}});}
  }finally{clearInterval(heartbeat);await reader?.cancel().catch(()=>{});reader?.releaseLock();if(!detached)try{controller.close();}catch{}finish();}
 };
 const stream=new ReadableStream<Uint8Array>({start(c){controller=c;void pump();},async cancel(){detached=true;if(!requests){abort.abort();await reader?.cancel().catch(()=>{});await settle('uncertain','client_disconnected');}}});
 return{stream,finished};
}
