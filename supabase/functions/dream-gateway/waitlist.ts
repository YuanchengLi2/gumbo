/** The paid beta's waitlist. usegumbo.app sends who wants in (an email and the first edit they would ask for); the
 * owner emails the ones they pick and invites them on the dashboard (spend-dashboard.ts), which gives their account
 * beta access. Joining needs no account. A bot that fills the hidden website field is answered as if it joined, and one
 * network address (kept only as a digest) may join a few times an hour. Joining twice keeps the first entry. */
export type WaitlistRow={email:string;first_ask:string;source:string;address:string};
/** join answers whether the email is new (a second join keeps the first entry); alert tells the owner about a new one. */
export type WaitlistPorts={joinedFrom(address:string,since:Date):Promise<number>;join(row:WaitlistRow):Promise<boolean>;alert?(row:WaitlistRow):Promise<void>};
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
 const row={email,first_ask:String(given.firstAsk??'').trim().slice(0,500),source:String(given.source??'site').trim().slice(0,60),address:who};
 // The owner hears about each new entry; an email that cannot be sent never fails the join.
 if(await ports.join(row))await ports.alert?.(row).catch(error=>console.warn('Waitlist alert not sent:',(error as Error).message));
 return {status:200,body:{joined:true}};
}

export function supabaseWaitlistPorts(db:any):WaitlistPorts{
 return {
  async joinedFrom(address,since){const {count,error}=await db.from('dream_waitlist').select('email',{count:'exact',head:true}).eq('address',address).gte('created_at',since.toISOString());if(error)throw error;return count??0;},
  async join(row){const {data,error}=await db.from('dream_waitlist').upsert(row,{onConflict:'email',ignoreDuplicates:true}).select('email');if(error)throw error;return(data?.length??0)>0;}};
}

const html=(text:string)=>text.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]!);
/** An email to the owner for each new signup (the open beta still records signups in the waitlist), through Resend (RESEND_API_KEY, to WAITLIST_ALERT_TO). Without both
 * secrets there are no alerts. Resend's shared sender reaches only the address the Resend account was made with, so
 * WAITLIST_ALERT_FROM is needed only to send from a domain verified there. */
export function waitlistAlert(env:(name:string)=>string|undefined,request:typeof fetch=fetch):WaitlistPorts['alert']{
 const key=env('RESEND_API_KEY'),to=env('WAITLIST_ALERT_TO');if(!key||!to)return undefined;
 const from=env('WAITLIST_ALERT_FROM')||'Gumbo waitlist <onboarding@resend.dev>';
 return async row=>{
  const ask=row.first_ask?`<p><b>First edit they'd ask for:</b><br>${html(row.first_ask)}</p>`:'<p>No first edit given.</p>';
  const response=await request('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(5000),
   body:JSON.stringify({from,to:to.split(',').map(a=>a.trim()).filter(Boolean),reply_to:row.email,subject:`New Gumbo signup: ${row.email}`,
    text:`${row.email} signed up on usegumbo.app (${row.source} form).
First edit they'd ask for: ${row.first_ask||'(none)'}

Every signup: https://usegumbo.app/dashboard/`,
    html:`<p><b>${html(row.email)}</b> signed up on usegumbo.app (${html(row.source)} form).</p>${ask}<p><a href="https://usegumbo.app/dashboard/">Every signup is on the dashboard</a>. Reply to this email to write to them.</p>`})});
  if(!response.ok)throw new Error(`Resend answered ${response.status}: ${(await response.text()).slice(0,200)}`);
 };
}
