/** Who a session token belongs to, remembered for a minute in this instance, so a run of quick calls (Tab suggestions
 * seconds apart) skips the three database round trips that check the session, activate the account and look up its
 * beta access. An entry never outlives the token's own expiry, and only a session that was let in is remembered: a
 * refusal is asked again every time, so an invitation or a new session counts at once. Keys are hashes, not tokens. */
export type AuthEntry={user:{id:string;email?:string;is_anonymous?:boolean};beta?:boolean};
export class AuthCache{
 private entries=new Map<string,AuthEntry&{until:number}>();
 constructor(private ttlMs=60_000,private max=5_000,private now=()=>Date.now()){}
 async get(token:string):Promise<AuthEntry|undefined>{
  const key=await hash(token),entry=this.entries.get(key);if(!entry)return;
  if(entry.until<=this.now()){this.entries.delete(key);return;}
  return entry;
 }
 async set(token:string,entry:AuthEntry){
  const now=this.now(),expires=jwtExpiry(token),until=Math.min(now+this.ttlMs,expires===undefined?now+this.ttlMs:expires*1000);
  if(until<=now)return;
  const key=await hash(token);this.entries.delete(key);
  if(this.entries.size>=this.max)this.entries.delete(this.entries.keys().next().value!);
  this.entries.set(key,{...entry,until});
 }
}
export function jwtExpiry(token:string):number|undefined{
 try{const part=token.split('.')[1].replace(/-/g,'+').replace(/_/g,'/');const payload=JSON.parse(atob(part+'='.repeat((4-part.length%4)%4)));return typeof payload.exp==='number'?payload.exp:undefined;}
 catch{return undefined;}
}
const hash=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),b=>b.toString(16).padStart(2,'0')).join('');
/** The Server-Timing header for a response: each step's milliseconds, so the extension's latency meter sees where the
 * time before the first word went. */
export const serverTiming=(timing:Record<string,number>)=>Object.entries(timing).filter(([,ms])=>Number.isFinite(ms)).map(([name,ms])=>`${name};dur=${Math.round(ms)}`).join(', ');
