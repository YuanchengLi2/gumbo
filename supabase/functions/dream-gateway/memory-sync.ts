/** Memory sync for Gumbo for Chrome (migrations/202610260001_memory_sync.sql): the synced copy of the memory each computer
 * keeps, so it is the same on every computer the user signs in on. It is end-to-end encrypted: the key is made on the
 * user's computer from a passphrase only they know (the extension's shared/sync-crypto.ts), so this gateway only ever
 * holds ciphertext. Per record it knows an opaque id, a stamp (time, computer id, version) and the sealed body; per
 * account, the key's id, its salt, how it was made and a check value, none of which opens anything.
 * - memory-sync (GET): the account's key profile, or null when sync was never set up.
 * - memory-sync-setup: keeps a new key profile; refused when the account already has one.
 * - memory-sync-push: records, kept only where they are newer than the copy here (last write wins, per record), until
 *   the account's room is full (dream_limits.memory_sync_bytes).
 * - memory-sync-pull: the records taken after a point, in the order they were taken, a few megabytes at a time.
 * - memory-sync-reset: deletes the synced copy and its key profile (a new passphrase, or sync turned off for good).
 * Pushes and pulls name the key they were sealed with: once another computer has set a new passphrase they are refused
 * (409 key_changed), so nothing is mixed under two keys. */
export const SYNC_MAX_RECORD=4_000_000,SYNC_MAX_BATCH=500,SYNC_MAX_BATCH_BYTES=10_000_000,SYNC_PULL_LIMIT=500,SYNC_PULL_BYTES=4_000_000;
export type SyncProfileRow={key_id:string;salt:string;kdf:{name:string;hash:string;iterations:number};verifier:string;bytes:number;limit_bytes:number};
export type SyncRecord={sid:string;at:number;device:string;version:number;payload:string;seq?:number};
export type MemorySyncPorts={
 profile(user:string):Promise<SyncProfileRow|null>;
 /** False when the account already has a profile. */
 create(user:string,profile:Omit<SyncProfileRow,'bytes'|'limit_bytes'>):Promise<boolean>;
 reset(user:string):Promise<void>;
 /** Null when keyId is not the account's key. */
 push(user:string,keyId:string,rows:SyncRecord[]):Promise<{applied:number;older:string[];taken:number;full:boolean;bytes:number;limit:number}|null>;
 pull(user:string,keyId:string,since:number,limit:number,maxBytes:number):Promise<{rows:SyncRecord[];more:boolean}|null>;
};
type Result={status:number;body:unknown};
const id=(value:unknown,min:number,max:number)=>typeof value==='string'&&value.length>=min&&value.length<=max&&/^[A-Za-z0-9_-]+$/.test(value);
const count=(value:unknown,max=Number.MAX_SAFE_INTEGER)=>Number.isSafeInteger(value)&&(value as number)>=0&&(value as number)<=max;
const base64=(value:unknown)=>typeof value==='string'&&value.length>0&&/^[A-Za-z0-9+/]+=*$/.test(value);
const keyChanged:Result={status:409,body:{error:'The sync passphrase was changed on another computer.',code:'key_changed'}};

export async function readSyncProfile(user:string,ports:MemorySyncPorts):Promise<Result>{
 const row=await ports.profile(user);
 return{status:200,body:{profile:row?{keyId:row.key_id,salt:row.salt,kdf:row.kdf,verifier:row.verifier}:null,bytes:row?.bytes??0,limit:row?.limit_bytes??null}};
}

export async function handleMemorySync(action:string,body:any,user:string,ports:MemorySyncPorts):Promise<Result>{
 if(action==='memory-sync-setup'){
  const kdf=body?.kdf;
  if(!id(body?.keyId,16,64)||!base64(body?.salt)||String(body.salt).length>64||!base64(body?.verifier)||String(body.verifier).length>128
   ||kdf?.name!=='PBKDF2'||kdf?.hash!=='SHA-256'||!count(kdf?.iterations,10_000_000)||kdf.iterations<100_000)return{status:400,body:{error:'That is not a sync key.'}};
  const created=await ports.create(user,{key_id:body.keyId,salt:body.salt,kdf:{name:'PBKDF2',hash:'SHA-256',iterations:kdf.iterations},verifier:body.verifier});
  if(!created)return{status:409,body:{error:'Sync is already set up for this account on another computer.',code:'exists',...(await readSyncProfile(user,ports)).body as object}};
  return{status:200,body:{created:true}};
 }
 if(action==='memory-sync-reset'){await ports.reset(user);return{status:200,body:{reset:true}};}
 if(!id(body?.keyId,16,64))return{status:400,body:{error:'Which key is this?'}};
 if(action==='memory-sync-pull'){
  const since=body.since??0,limit=Math.min(SYNC_PULL_LIMIT,Number.isSafeInteger(body.limit)&&body.limit>0?body.limit:SYNC_PULL_LIMIT);
  if(!count(since))return{status:400,body:{error:'Pull from where?'}};
  const result=await ports.pull(user,body.keyId,since,limit,SYNC_PULL_BYTES);
  return result?{status:200,body:result}:keyChanged;
 }
 if(action==='memory-sync-push'){
  const rows=body.rows;
  if(!Array.isArray(rows)||!rows.length||rows.length>SYNC_MAX_BATCH)return{status:400,body:{error:`Send between 1 and ${SYNC_MAX_BATCH} records.`}};
  let bytes=0;
  for(const row of rows){
   if(!id(row?.sid,8,64)||!count(row.at)||!id(row.device,4,64)||!count(row.version,2_147_483_647)||!base64(row.payload))return{status:400,body:{error:'That is not a sealed record.'}};
   if(row.payload.length>SYNC_MAX_RECORD)return{status:413,body:{error:'A record is too large to sync.'}};
   bytes+=row.payload.length;
  }
  if(bytes>SYNC_MAX_BATCH_BYTES)return{status:413,body:{error:'Send fewer records at a time.'}};
  if(new Set(rows.map((r:SyncRecord)=>r.sid)).size!==rows.length)return{status:400,body:{error:'A record is in this batch twice.'}};
  const result=await ports.push(user,body.keyId,rows.map((r:SyncRecord)=>({sid:r.sid,at:r.at,device:r.device,version:r.version,payload:r.payload})));
  return result?{status:200,body:result}:keyChanged;
 }
 return{status:404,body:{error:'Unknown command'}};
}

/** The ports over the gateway's Supabase client (service role); the functions take the account's lock, so its pushes and
 * pulls are taken one at a time and a pull never skips a push that was still being written. */
export function supabaseMemorySyncPorts(db:any):MemorySyncPorts{
 const rpc=async(name:string,args:Record<string,unknown>)=>{const {data,error}=await db.rpc(name,args);if(error)throw new Error(error.message);return data;};
 return{
  profile:async user=>(await rpc('dream_memory_sync_profile',{p_user:user}))??null,
  create:async(user,p)=>Boolean(await rpc('dream_memory_sync_setup',{p_user:user,p_key_id:p.key_id,p_salt:p.salt,p_kdf:p.kdf,p_verifier:p.verifier})),
  reset:async user=>{await rpc('dream_memory_sync_reset',{p_user:user});},
  push:async(user,keyId,rows)=>{const r=await rpc('dream_memory_sync_push',{p_user:user,p_key_id:keyId,p_rows:rows});return r?.error?null:r;},
  pull:async(user,keyId,since,limit,maxBytes)=>{const r=await rpc('dream_memory_sync_pull',{p_user:user,p_key_id:keyId,p_since:since,p_limit:limit,p_max_bytes:maxBytes});return r?.error?null:r;},
 };
}
