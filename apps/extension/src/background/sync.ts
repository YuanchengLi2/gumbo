import {getSealed,putSealed,syncing,setSyncing,enroll,nameChanges,outgoing,sent,arrive,syncCounts,add,removePassages,SYNCED,type Synced,type Page} from './db';
import {Locked} from './vault';
import {token} from './auth';
import {offscreen} from './offscreen';
import {invalidate,passagesOf} from './recall';
import {memoryReset} from './search';
import {endpoints} from '../shared/config';
import {gatewayGet,gatewayPost,GatewayError} from '../shared/gateway';
import {createProfile,unlockProfile,syncKeys,sidOf,b64,unb64,randomId,normalize,MIN_PASSPHRASE,type SyncProfile} from '../shared/sync-crypto';
import {pull,push,KeyChanged,type Replica,type Remote} from '../shared/sync-engine';
/** Memory on every computer the user signs in on, end-to-end encrypted with a key only they hold.
 * - The key is made here from a passphrase the user sets (shared/sync-crypto.ts) and kept sealed in memory's own
 *   database, like everything else there; the passphrase is never kept and neither leaves the computer. Another
 *   computer makes the same key from the same passphrase; the gateway holds only ciphertext (memory-sync routes).
 * - What syncs: writing, notes, the sidebar's conversations, voices, meetings and videos heard, and pages read
 *   (db.ts SYNCED). A page's passages are cut again where it arrives, and embeddings are made there.
 * - Pulled when the browser starts and every 15 minutes; pushed in batches when the computer is idle and plugged in (on
 *   battery at most every six hours, never on a low one), and at once when the user asks or forgets something.
 * - Merging is last write wins per record (shared/sync-engine.ts); what the user forgets here is forgotten everywhere.
 * - The passphrase can't be recovered. Losing it loses nothing on the computers; "Start over" sets a new one and the
 *   synced copy is made again from this computer. */
type Secret={keyId:string;master:string;cursor:number};
/** How sync went, sealed with memory (it says nothing about what is in it, but stays with the account). */
type Saved={lastPull?:number;lastPush?:number;error?:string;full?:number;changed?:boolean;notice?:'gone'};
export type SyncState={on:false;notice?:'gone'}|{on:true;phase?:'pulling'|'pushing';changed:boolean;lastPull?:number;lastPush?:number;error?:string;full:boolean;pending:number;records:number};
let phase:'pulling'|'pushing'|undefined;
const secret=async()=>(await getSealed<Secret|null>('sync'))??undefined;
const saved=async()=>(await getSealed<Saved>('syncStatus'))??{};
const save=async(change:Partial<Saved>)=>putSealed('syncStatus',{...await saved(),...change});

async function call(route:string,body?:unknown):Promise<any>{
 const bearer=await token();if(!bearer)throw new Locked();
 const {gateway}=await endpoints();
 try{return body===undefined?await gatewayGet(gateway,bearer,route):await gatewayPost(gateway,bearer,route,body);}
 catch(error){if(error instanceof GatewayError&&error.type==='key_changed')throw new KeyChanged();throw error;}
}
const remote=(keyId:string):Remote=>({pull:since=>call('memory-sync-pull',{keyId,since}),push:rows=>call('memory-sync-push',{keyId,rows})});
/** The account's key profile on the gateway: none until a computer sets sync up. */
export const account=():Promise<{profile:SyncProfile|null;bytes:number;limit:number|null}>=>call('memory-sync');

function replica(s:Secret):Replica{
 return{
  cursor:async()=>s.cursor,
  setCursor:async seq=>{s.cursor=seq;await putSealed('sync',s);},
  prepare:keys=>nameChanges((store,natural)=>sidOf(keys,store,natural)),
  outgoing,sent,
  apply:async(sid,stamp,body)=>{
   if(!(SYNCED as readonly string[]).includes(body.s))return false;
   const store=body.s as Synced,changed=await arrive(store,sid,stamp,body.v);
   // A page arriving is cut into passages here, for search, as it is when it is read.
   if(changed&&store==='pages'&&body.v){const page=body.v as Page;await removePassages(page.url);for(const passage of passagesOf(page.text).slice(0,400))await add('passages',{ref:page.url,kind:'page',text:passage,at:page.lastSeen,site:page.site,title:page.title,url:page.url});}
   return changed;
  },
 };
}

/** Runs one at a time; each run pulls, pushes or both. A push is 'force' when the user asked (Sync now, forgetting),
 * 'start' when sync was just turned on (the first thousand records, what the user made first; the rest waits for an idle
 * moment), or 'idle'. */
let chain:Promise<unknown>=Promise.resolve();
type Push='force'|'start'|'idle';
type Run={pull?:boolean;push?:Push};
export function syncNow(run:Run={pull:true,push:'force'}):Promise<void>{const next=chain.then(()=>once(run));chain=next.catch(()=>{});return next;}
async function once({pull:pulling=false,push:pushing}:Run){
 let s:Secret|undefined;try{s=await secret();if(!s||(await saved()).changed)return;}catch{return;}
 const keys=await syncKeys(unb64(s.master),s.keyId),server=remote(s.keyId),local=replica(s);
 try{
  if(pulling){
   phase='pulling';const {applied}=await pull(local,server,keys);
   // What arrived is searchable at once: memory's caches and the search index are made again.
   if(applied){invalidate();memoryReset();}
   await save({lastPull:Date.now(),error:undefined});
  }
  if(pushing&&await mayPush(pushing)){
   let batches=0;phase='pushing';const result=await push(local,server,keys,{between:()=>between(pushing,++batches)});
   await save({lastPush:Date.now(),full:result.full?Date.now():undefined,error:undefined});
  }
 }catch(error){
  if(error instanceof KeyChanged){
   // Another computer set a new passphrase (sync waits for it here), or deleted the synced copy (sync stops here).
   const now=await account().catch(()=>undefined);
   if(now&&!now.profile){await stop();await save({notice:'gone'});}else await save({changed:true});
  }else if(!(error instanceof Locked))await save({error:(error as Error).message}).catch(()=>{});
 }finally{phase=undefined;}
}
/** A push nobody asked for waits until the computer is idle and plugged in. On battery it goes at most every six hours,
 * on a low battery not at all; when the synced copy was full it tries again six hours later. */
async function mayPush(how:Push){
 if(how!=='idle')return true;
 const {lastPush,full}=await saved();
 if((await syncCounts()).pending===0||await chrome.idle.queryState(60)==='active'||full&&Date.now()-full<6*3_600_000)return false;
 const power=await offscreen<{power:'full'|'gentle'|'low'}>({type:'power'}).then(a=>a.power,()=>'full' as const);
 return power==='full'||power==='gentle'&&Date.now()-(lastPush??0)>6*3_600_000;
}
/** Between batches (of a hundred): a short rest; a push nobody asked for stops when the user is back. */
async function between(how:Push,batches:number){
 await new Promise(r=>setTimeout(r,300));
 return how==='force'||how==='start'&&batches<10||await chrome.idle.queryState(60)!=='active';
}

/** Turns sync on with a new passphrase, for an account that has no synced copy yet. */
export async function setUp(passphrase:string):Promise<{ok:true}|{error:string;code?:string}>{
 let made;try{made=await createProfile(passphrase);}catch(error){return{error:(error as Error).message,code:'short'};}
 try{await call('memory-sync-setup',made.profile);}
 catch(error){if(error instanceof GatewayError&&error.type==='exists')return{error:'Sync is already on for your account on another computer: enter its passphrase.',code:'exists'};throw error;}
 await start(made.profile.keyId,made.master);return{ok:true};
}
/** Joins the synced copy another computer set up, with its passphrase. */
export async function join(passphrase:string):Promise<{ok:true}|{error:string;code?:string}>{
 const {profile}=await account();if(!profile)return{error:'Sync is not set up for your account yet.',code:'none'};
 const master=await unlockProfile(passphrase,profile);
 if(!master)return{error:'That passphrase doesn’t open your synced memory.',code:'wrong'};
 await start(profile.keyId,master);return{ok:true};
}
/** Sets a new passphrase when the old one is lost: the synced copy is deleted and made again from this computer; the
 * other computers are asked for the new passphrase and keep what they have. */
export async function startOver(passphrase:string){
 if(normalize(passphrase).length<MIN_PASSPHRASE)return{error:`Use at least ${MIN_PASSPHRASE} characters.`,code:'short'};
 await call('memory-sync-reset',{});return setUp(passphrase);
}
async function start(keyId:string,master:Uint8Array<ArrayBuffer>){
 const before=await secret();
 await putSealed('sync',{keyId,master:b64(master),cursor:0} satisfies Secret);
 await setSyncing({device:(await syncing())?.device??randomId(8)});
 await putSealed('syncStatus',{});
 // Everything already here is sent; under a key this computer hasn't used, everything is named again first.
 await enroll({rename:before?.keyId!==keyId});
 void syncNow({pull:true,push:'start'});
}
/** Sync off on this computer: its memory stays, and the synced copy stays for the other computers. */
export async function turnOff(){await stop();await putSealed('syncStatus',{});}
/** Deletes the synced copy; sync stops here, and the other computers stop at their next sync. */
export async function deleteSynced(){await call('memory-sync-reset',{});await turnOff();}
async function stop(){await setSyncing(undefined);await putSealed('sync',null);}

export async function syncState():Promise<SyncState>{
 const s=await secret(),status=await saved();
 if(!s)return{on:false,notice:status.notice};
 return{on:true,phase,changed:!!status.changed,lastPull:status.lastPull,lastPush:status.lastPush,error:status.error,full:!!status.full,...await syncCounts()};
}
/** Before forgetting: every record is named, so what is forgotten can be forgotten on the other computers too. */
export async function beforeForget(){
 const s=await secret().catch(()=>undefined);if(!s)return;
 const keys=await syncKeys(unb64(s.master),s.keyId);await nameChanges((store,natural)=>sidOf(keys,store,natural));
}

chrome.runtime.onStartup.addListener(()=>void syncNow({pull:true}));
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name==='memory-sync')void syncNow({pull:true,push:'idle'});});
void chrome.alarms.get('memory-sync').then(alarm=>{if(!alarm)void chrome.alarms.create('memory-sync',{periodInMinutes:15,delayInMinutes:1});});
chrome.idle.onStateChanged.addListener(state=>{if(state!=='active')void syncNow({push:'idle'});});
