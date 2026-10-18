/** The paid beta's waitlist. usegumbo.app sends who wants in (an email and the first edit they would ask for); the
 * owner emails the ones they pick and invites them on the dashboard (spend-dashboard.ts), which gives their account
 * beta access. Joining needs no account. A bot that fills the hidden website field is answered as if it joined, and one
 * network address (kept only as a digest) may join a few times an hour. Joining twice keeps the first entry. */
export type WaitlistRow={email:string;first_ask:string;source:string;address:string};
export type WaitlistPorts={joinedFrom(address:string,since:Date):Promise<number>;join(row:WaitlistRow):Promise<void>};
export const MAX_JOINS_PER_HOUR=5;
export const WAITLISTED="You're on the Gumbo waitlist. We'll email you when your spot opens.";
const EMAIL=/^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;
export const validEmail=(email:string)=>email.length<=254&&EMAIL.test(email);

const hex=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(b=>b.toString(16).padStart(2,'0')).join('');

export async function handleWaitlistJoin(body:unknown,address:string,ports:WaitlistPorts):Promise<{status:number;body:Record<string,unknown>}>{
 const given=(body&&typeof body==='object'?body:{}) as Record<string,unknown>;
 if(typeof given.website==='string'&&given.website.trim())return {status:200,body:{joined:true}};
 const email=String(given.email??'').trim().toLowerCase();
 if(!validEmail(email))return {status:400,body:{error:'Enter a valid email address.'}};
 const who=await hex('waitlist:'+address);
 if(await ports.joinedFrom(who,new Date(Date.now()-3_600_000))>=MAX_JOINS_PER_HOUR)return {status:429,body:{error:'Too many sign-ups from here. Try again in an hour.'}};
 await ports.join({email,first_ask:String(given.firstAsk??'').trim().slice(0,500),source:String(given.source??'site').trim().slice(0,60),address:who});
 return {status:200,body:{joined:true}};
}

export function supabaseWaitlistPorts(db:any):WaitlistPorts{
 return {
  async joinedFrom(address,since){const {count,error}=await db.from('dream_waitlist').select('email',{count:'exact',head:true}).eq('address',address).gte('created_at',since.toISOString());if(error)throw error;return count??0;},
  async join(row){const {error}=await db.from('dream_waitlist').upsert(row,{onConflict:'email',ignoreDuplicates:true});if(error)throw error;}};
}
