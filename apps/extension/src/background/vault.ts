import {endpoints} from '../shared/config';
import {gatewayGet} from '../shared/gateway';
import {session,token} from './auth';
/** Memory is sealed on this computer. Every record is encrypted with AES-256-GCM under a data key; what lookups need
 * (a site, an address) is stored only as a keyed hash; nothing readable lands on disk.
 * - The data key is random, made once per account, and stored wrapped (encrypted) by a key-encryption key.
 * - The key-encryption key comes from the account: the gateway derives it from the user's id and a secret only it holds
 *   (memory-key), so a copy of the browser profile is unreadable without signing in to Gumbo. Until the gateway has that
 *   route, a key kept in the extension's own storage stands in, and the data key is re-wrapped the first time the
 *   account key is available (the data itself never needs re-encrypting).
 * - The unwrapped data key lives only in memory (the worker, and chrome.storage.session, which is never written to disk
 *   and which pages' content scripts cannot read), so it is gone when the browser closes or the user signs out.
 * Each account on a computer has its own database. */
export class Locked extends Error{constructor(){super('Memory is locked: sign in to Gumbo.');}}
export type Box={iv:Uint8Array<ArrayBuffer>;data:ArrayBuffer};
type Keys={user:string;dek:CryptoKey;index:CryptoKey};
const enc=new TextEncoder(),dec=new TextDecoder();
let keys:Keys|undefined,opening:Promise<Keys>|undefined;
const b64=(bytes:ArrayBuffer|Uint8Array)=>btoa(String.fromCharCode(...new Uint8Array(bytes)));
const unb64=(text:string)=>Uint8Array.from(atob(text),c=>c.charCodeAt(0)) as Uint8Array<ArrayBuffer>;

/** The database name for an account: a hash of its id, so the name says nothing about who it is. */
export async function databaseName(user:string){return 'gumbo-memory-'+[...new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode('gumbo:'+user)))].slice(0,8).map(b=>b.toString(16).padStart(2,'0')).join('');}

/** In the offscreen document, which has no chrome.storage: the account and its unwrapped data key, handed over by the
 * worker with each request and kept in memory only, as in the worker. */
let given:{user:string;raw:Uint8Array<ArrayBuffer>}|undefined;
export function useKeys(user:string,dek:string){if(given?.user===user&&b64(given.raw)===dek)return;given={user,raw:unb64(dek)};keys=undefined;}
/** The signed-in account's id, or null. */
export async function currentUser():Promise<string|null>{if(given)return given.user;return(await session())?.user.id??null;}
/** The unwrapped key, to hand to the offscreen document. */
export async function exportKeys(meta:Parameters<typeof vaultKeys>[0]):Promise<{user:string;dek:string}>{
 const k=await vaultKeys(meta);const cached=(await chrome.storage.session.get('vault')).vault as {user:string;dek:string}|undefined;
 if(!cached||cached.user!==k.user)throw new Locked();return cached;
}
/** The keys for the signed-in account, unwrapping (or making) the data key on first use. */
export async function vaultKeys(meta:{get:(key:string)=>Promise<unknown>;set:(key:string,value:unknown)=>Promise<void>}):Promise<Keys>{
 if(given){if(keys?.user===given.user)return keys;return keys=await fromRaw(given.user,given.raw);}
 const now=await session();if(!now)throw new Locked();
 if(keys?.user===now.user.id)return keys;
 return opening??=(async()=>{
  try{
   const cached=(await chrome.storage.session.get('vault')).vault as {user:string;dek:string}|undefined;
   if(cached?.user===now.user.id)return keys=await fromRaw(now.user.id,unb64(cached.dek));
   const wrapped=await meta.get('dek') as {by:'account'|'local';iv:string;key:string}|undefined;
   const account=await accountKek(now.user.id),local=await localKek(now.user.id,!account);
   let raw:Uint8Array<ArrayBuffer>;
   if(!wrapped){raw=crypto.getRandomValues(new Uint8Array(32));}
   else{
    const kek=wrapped.by==='account'?account:local;if(!kek)throw new Locked();
    raw=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:unb64(wrapped.iv)},kek,unb64(wrapped.key)));
   }
   // Wrap with the account key whenever it is there (the first time, or moving off the stand-in local key).
   if(!wrapped||(wrapped.by==='local'&&account)){
    const kek=account??local!,iv=crypto.getRandomValues(new Uint8Array(12));
    await meta.set('dek',{by:account?'account':'local',iv:b64(iv),key:b64(await crypto.subtle.encrypt({name:'AES-GCM',iv},kek,raw))});
    if(account)await chrome.storage.local.remove(localKey(now.user.id));
   }
   await chrome.storage.session.set({vault:{user:now.user.id,dek:b64(raw)}});
   return keys=await fromRaw(now.user.id,raw);
  }finally{opening=undefined;}
 })();
}
/** Forgets the unwrapped key (on sign-out): memory stays on disk, sealed. */
export async function lock(){keys=undefined;await chrome.storage.session.remove('vault');}

async function fromRaw(user:string,raw:Uint8Array<ArrayBuffer>):Promise<Keys>{
 const dek=await crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt','decrypt']);
 const base=await crypto.subtle.importKey('raw',raw,'HKDF',false,['deriveKey']);
 const index=await crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:enc.encode('gumbo-index'),info:enc.encode('v1')},base,{name:'HMAC',hash:'SHA-256',length:256},false,['sign']);
 return{user,dek,index};
}
async function accountKek(user:string):Promise<CryptoKey|null>{
 try{
  const cached=(await chrome.storage.session.get('accountKek')).accountKek as {user:string;key:string}|undefined;
  let raw=cached?.user===user?unb64(cached.key):undefined;
  if(!raw){
   const bearer=await token();if(!bearer)return null;const {gateway}=await endpoints();
   const answer=await gatewayGet(gateway,bearer,'memory-key') as {key?:string};if(!answer.key)return null;
   raw=unb64(answer.key);await chrome.storage.session.set({accountKek:{user,key:b64(raw)}});
  }
  return crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt','decrypt']);
 }catch{return null;}
}
const localKey=(user:string)=>'vaultLocal:'+user;
async function localKek(user:string,create:boolean):Promise<CryptoKey|null>{
 const stored=(await chrome.storage.local.get(localKey(user)))[localKey(user)] as string|undefined;
 let raw=stored?unb64(stored):undefined;
 if(!raw){if(!create)return null;raw=crypto.getRandomValues(new Uint8Array(32));await chrome.storage.local.set({[localKey(user)]:b64(raw)});}
 return crypto.subtle.importKey('raw',raw,'AES-GCM',false,['encrypt','decrypt']);
}

export async function seal(k:Keys,value:unknown):Promise<Box>{
 const iv=crypto.getRandomValues(new Uint8Array(12));
 return{iv,data:await crypto.subtle.encrypt({name:'AES-GCM',iv},k.dek,enc.encode(JSON.stringify(value)))};
}
export async function open<T>(k:Keys,box:Box):Promise<T>{return JSON.parse(dec.decode(await crypto.subtle.decrypt({name:'AES-GCM',iv:box.iv},k.dek,box.data)));}
/** A keyed hash for lookups (a site, an address): equal values give equal hashes, and nothing can be read back. */
export async function hashOf(k:Keys,value:string):Promise<string>{
 const mac=new Uint8Array(await crypto.subtle.sign('HMAC',k.index,enc.encode(value.toLowerCase())));
 return b64(mac.slice(0,16)).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}
/** Sealing bytes as they are (an embedding vector), without JSON in between. */
export async function sealBytes(k:Keys,bytes:Uint8Array<ArrayBuffer>):Promise<Box>{
 const iv=crypto.getRandomValues(new Uint8Array(12));return{iv,data:await crypto.subtle.encrypt({name:'AES-GCM',iv},k.dek,bytes)};
}
export async function openBytes(k:Keys,box:Box):Promise<Uint8Array>{return new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:box.iv},k.dek,box.data));}
