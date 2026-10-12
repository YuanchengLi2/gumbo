import {EditOutcomeSchema,type EditOutcome} from '@dream/contracts';

export class BlockedEditError extends Error {
 constructor(public outcome:Extract<EditOutcome,{status:'blocked'}>){super(`${outcome.summary}\n${outcome.nextAction}`);this.name='BlockedEditError';}
}

export function exposeExecutionReceipt(result:any){
 if(result.type!=='tool_result'||result.is_error)return;
 const reference=`Execution receipt for report evidence: ${result.tool_use_id}`;
 const content=Array.isArray(result.content)?result.content:[{type:'text',text:String(result.content??'')}];
 if(!content.some((block:any)=>block.type==='text'&&block.text===reference))content.unshift({type:'text',text:reference});
 result.content=content;
}

export function exposeSavedReceipts(messages:any[]){
 for(const message of messages)if(message.role==='user'&&Array.isArray(message.content))for(const result of message.content)exposeExecutionReceipt(result);
}

// Receipts come from executed tools, including restored checkpoints, never from model claims.
export function validateOutcome(raw:unknown,messages:any[],pending:any[],results:any[],receipts:{call_id:string;name:string;result:any}[]=[]):EditOutcome {
 const outcome=EditOutcomeSchema.parse(raw);
 const calls=new Map<string,string>(),successful=new Set<string>();
 for(const message of [...messages,{role:'assistant',content:pending},{role:'user',content:results}]){
  if(!Array.isArray(message.content))continue;
  for(const item of message.content){
   if(message.role==='assistant'&&item.type==='tool_use')calls.set(item.id,item.name);
   if(message.role==='user'&&item.type==='tool_result'&&!item.is_error)successful.add(item.tool_use_id);
  }
 }
 for(const receipt of receipts){calls.set(receipt.call_id,receipt.name);if(!receipt.result.is_error)successful.add(receipt.call_id);}
 for(const proof of outcome.evidence){
  if(!successful.has(proof.toolCallId)||!calls.has(proof.toolCallId)||['report'].includes(calls.get(proof.toolCallId)!))throw new Error('Completion evidence must reference a successful project read, preview, or editing tool from this step. Advice alone is not evidence.');
 }
 return outcome;
}
