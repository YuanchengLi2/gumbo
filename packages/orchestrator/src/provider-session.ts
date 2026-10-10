import {createHash} from 'node:crypto';
import type {ProjectDB} from '@dream/project-db';

const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
type Message={role:string;content:any};
type Session={epoch:number;configuration:string;request:string;continuation?:string[]};
export type ProviderConnection={url:string;token:string;accountId?:string};
export function accountScope(connection:ProviderConnection){
 if(connection.accountId)return connection.accountId;
 try{const subject=JSON.parse(Buffer.from(connection.token.split('.')[1],'base64url').toString()).sub;if(typeof subject==='string')return subject;}catch{}
 // Standalone callers without an authenticated subject must not share receipts across credentials.
 return hash(connection.token);
}

/** Thinking is replayable only against the exact prefix that produced it. Local history is never rewritten. */
export function providerSession(db:ProjectDB,connection:ProviderConnection,input:{turnId?:string;purpose:string;model:string;system:string;tools:unknown[];messages:any[];profile?:unknown;tool_choice?:unknown;phase?:string}){
 const account=accountScope(connection),configuration=hash({gateway:connection.url,account,model:input.model,system:input.system,tools:input.tools,profile:input.profile,tool_choice:input.tool_choice});
 // One session per conversation phase: parallel workers share a purpose but are separate conversations.
 const key=`provider-session:${account}:${input.turnId??'standalone'}:${input.purpose}:${input.phase??'main'}`;
 const normalized:Message[]=[];
 const binding=(messages:Message[],content:any[])=>hash({configuration,messages,assistant:content});
 for(const message of input.messages){
  if(!Array.isArray(message.content)){normalized.push({role:message.role,content:message.content});continue;}
  const content:any[]=[];
  for(const block of message.content){
   if(block.type==='thinking'||block.type==='redacted_thinking'){
    const signature=block.signature??block.data;
    if(!signature||db.getMeta('thinking-origin:'+hash(signature))!==binding(normalized,content))continue;
   }
   content.push(structuredClone(block));
  }
  if(content.length)normalized.push({role:message.role,content});
 }
 const request=hash(normalized),previous=db.loadState<Session>(key),parts=normalized.map(hash);
 const appendOnly=previous?.continuation?.every((part,i)=>parts[i]===part);
 const changed=!!previous&&(previous.configuration!==configuration||previous.request!==request&&!appendOnly);
 const session:Session={epoch:(previous?.epoch??0)+(changed?1:0),configuration,request,continuation:previous?.configuration===configuration?previous.continuation:undefined};
 db.saveState(key,session);
 if(changed)db.event('ai.provider_epoch',{turnId:input.turnId,epoch:session.epoch,model:input.model});
 return {messages:normalized,account,epoch:session.epoch,configuration,record(content:any[]){
  const preceding:any[]=[];
  for(const block of content){if(block.type==='thinking'||block.type==='redacted_thinking'){const signature=block.signature??block.data;if(signature)db.setMeta('thinking-origin:'+hash(signature),binding(normalized,preceding));}preceding.push(block);}
  db.saveState(key,{...session,continuation:[...parts,hash({role:'assistant',content})]});
 }};
}
