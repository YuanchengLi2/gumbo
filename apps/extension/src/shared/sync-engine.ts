import {sealRow,openRow,type SyncKeys,type SyncRow,type Body,type Stamp} from './sync-crypto';
/** Memory sync, the part every computer runs the same way (background/sync.ts keeps it in IndexedDB, the tests in memory):
 * - every synced record has a change: its stamp (when, on which computer, which version) and whether it still has to be
 *   sent;
 * - pull: what the server took since the last pull, in the order it took it, each record applied here only if it is
 *   newer than this computer's version (last write wins, per record);
 * - push: what changed here, in batches, what the user made before what they read; the server keeps a version only if
 *   it is newer than its own, so two computers pushing at once still end on the same record;
 * - a deletion is a record with no value (a tombstone), sealed like any other, and wins or loses the same way. */
export class KeyChanged extends Error{constructor(public gone=false){super(gone?'The synced copy was deleted on another computer.':'The sync passphrase was changed on another computer.');}}

/** Whether version a wins over version b: the later write; at the same millisecond the higher computer id, so every
 * computer picks the same one. */
export function newer(a:Stamp,b:Stamp){return a.at!==b.at?a.at>b.at:a.device!==b.device?a.device>b.device:a.version>b.version;}
/** The stamp of a change made here: now, but always after the version it replaces, even one from a computer whose clock
 * runs ahead, so an edit made after seeing another computer's change wins over it. */
export function nextStamp(prev:Stamp|undefined,device:string,now=Date.now()):Stamp{return{at:Math.max(now,(prev?.at??0)+1),device,version:(prev?.version??0)+1};}

/** A record larger than this once sealed (a few megabytes) stays on its computer. */
export const MAX_RECORD=4_000_000;
export type Outgoing={sid:string;stamp:Stamp;body:Body};
export interface Replica{
 cursor():Promise<number>;
 setCursor(seq:number):Promise<void>;
 /** Gives every change waiting to be sent its id in the synced copy (a page's id comes from its address, inside it). */
 prepare(keys:SyncKeys):Promise<void>;
 /** Up to `limit` changes waiting to be sent, most important and newest first. */
 outgoing(limit:number):Promise<Outgoing[]>;
 /** Changes the server took, or already had a newer version of: sent, unless they changed again meanwhile. */
 sent(items:Outgoing[]):Promise<void>;
 /** A record from another computer, applied when it is newer than the version here; true when memory changed. */
 apply(sid:string,stamp:Stamp,body:Body):Promise<boolean>;
}
export interface Remote{
 /** What the server took after `since`, in order; throws KeyChanged when the key is no longer the account's. */
 pull(since:number):Promise<{rows:SyncRow[];more:boolean}>;
 /** Sends records; the server goes through them in order and says how many it went through (taken) before it was full. */
 push(rows:SyncRow[]):Promise<{taken:number;full:boolean}>;
}

export async function pull(replica:Replica,remote:Remote,keys:SyncKeys):Promise<{applied:number;unreadable:number}>{
 await replica.prepare(keys);
 let since=await replica.cursor(),applied=0,unreadable=0;
 for(;;){
  const {rows,more}=await remote.pull(since);
  for(const row of rows){
   let body:Body;
   // A record this key can't open (sealed under another key, or changed on the server) is left alone.
   try{body=await openRow(keys,row);}catch{unreadable++;continue;}
   if(await replica.apply(row.sid,{at:row.at,device:row.device,version:row.version},body))applied++;
  }
  if(rows.length){since=Math.max(since,...rows.map(r=>r.seq??0));await replica.setCursor(since);}
  if(!more||!rows.length)break;
 }
 return{applied,unreadable};
}

export async function push(replica:Replica,remote:Remote,keys:SyncKeys,{batch=100,maxBytes=4_000_000,between}:{batch?:number;maxBytes?:number;between?:()=>Promise<void>}={}):Promise<{sent:number;full:boolean;tooLarge:number}>{
 await replica.prepare(keys);
 let sent=0,tooLarge=0;
 for(;;){
  const out=await replica.outgoing(batch);if(!out.length)break;
  const rows:SyncRow[]=[],items:Outgoing[]=[],skipped:Outgoing[]=[];let bytes=0;
  for(const item of out){
   const row=await sealRow(keys,item.sid,item.stamp,item.body);
   if(row.payload.length>MAX_RECORD){skipped.push(item);tooLarge++;continue;}
   if(rows.length&&bytes+row.payload.length>maxBytes)break;
   rows.push(row);items.push(item);bytes+=row.payload.length;
  }
  // What can never be sent is marked sent, so it doesn't hold up the rest.
  if(skipped.length)await replica.sent(skipped);
  if(!rows.length)continue;
  const {taken,full}=await remote.push(rows);
  await replica.sent(items.slice(0,taken));sent+=taken;
  if(full)return{sent,full:true,tooLarge};
  if(taken<rows.length)break;
  await between?.();
 }
 return{sent,full:false,tooLarge};
}
