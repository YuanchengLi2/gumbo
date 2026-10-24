/** "Stumped or broken? Let me know" under the prompt box: one line about what failed, an optional email to hear back on,
 * and what the app was doing (its version, the project's state, the last request). It needs no account, so anyone stuck
 * can say so; a signed-in sender is known by their account. One network address (kept only as a digest) may send a few an
 * hour, and a bot that fills the hidden website field is answered as if it sent. The owner gets an email for each, which
 * they can answer straight to the sender's address when one was given. */
import {validEmail} from './waitlist.ts';
export const MAX_FEEDBACK_PER_HOUR=8,MAX_NOTE=2000;
export type FeedbackRow={user_id:string|null;email:string|null;note:string;context:Record<string,unknown>;app_version:string;platform:string;address:string};
export type FeedbackPorts={sentFrom(address:string,since:Date):Promise<number>;insert(row:FeedbackRow):Promise<void>;alert?(row:FeedbackRow):Promise<void>};

const hex=async(value:string)=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))).map(b=>b.toString(16).padStart(2,'0')).join('');
/** What the app says it was doing, kept small: short strings, numbers and booleans only, a dozen of them. */
function contextOf(value:unknown){
 const out:Record<string,unknown>={};if(!value||typeof value!=='object')return out;
 for(const [key,v] of Object.entries(value).slice(0,12))if(typeof v==='string')out[key.slice(0,40)]=v.slice(0,500);else if(typeof v==='number'||typeof v==='boolean')out[key.slice(0,40)]=v;
 return out;
}

export async function handleFeedback(body:unknown,address:string,user:string|null,ports:FeedbackPorts):Promise<{status:number;body:Record<string,unknown>}>{
 const given=(body&&typeof body==='object'?body:{}) as Record<string,unknown>;
 if(typeof given.website==='string'&&given.website.trim())return{status:200,body:{sent:true}};
 const note=String(given.note??'').trim().slice(0,MAX_NOTE);if(!note)return{status:400,body:{error:'Write a few words about what went wrong.'}};
 const email=String(given.email??'').trim().toLowerCase();if(email&&!validEmail(email))return{status:400,body:{error:'That email address does not look right.'}};
 const who=await hex('feedback:'+address);
 if(await ports.sentFrom(who,new Date(Date.now()-3_600_000))>=MAX_FEEDBACK_PER_HOUR)return{status:429,body:{error:'Thanks, that is plenty for now. Try again in an hour.'}};
 const row:FeedbackRow={user_id:user,email:email||null,note,context:contextOf(given.context),app_version:String(given.appVersion??'').slice(0,40),platform:String(given.platform??'').slice(0,60),address:who};
 await ports.insert(row);
 // The owner hears about each one; an email that cannot be sent never fails the feedback.
 await ports.alert?.(row).catch(error=>console.warn('Feedback alert not sent:',(error as Error).message));
 return{status:200,body:{sent:true}};
}

export function supabaseFeedbackPorts(db:any):FeedbackPorts{
 return{
  async sentFrom(address,since){const {count,error}=await db.from('dream_feedback').select('id',{count:'exact',head:true}).eq('address',address).gte('created_at',since.toISOString());if(error)throw error;return count??0;},
  async insert(row){const {error}=await db.from('dream_feedback').insert(row);if(error)throw error;}};
}

const html=(text:string)=>text.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]!);
/** An email to the owner for each, through Resend, as the waitlist's alerts (waitlist.ts): the same secrets. */
export function feedbackAlert(env:(name:string)=>string|undefined,request:typeof fetch=fetch):FeedbackPorts['alert']{
 const key=env('RESEND_API_KEY'),to=env('WAITLIST_ALERT_TO');if(!key||!to)return undefined;
 const from=env('WAITLIST_ALERT_FROM')||'Gumbo feedback <onboarding@resend.dev>';
 return async row=>{
  const facts=Object.entries(row.context).map(([k,v])=>`${k}: ${v}`).join('\n');
  const response=await request('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(5000),
   body:JSON.stringify({from,to:to.split(',').map(a=>a.trim()).filter(Boolean),...(row.email?{reply_to:row.email}:{}),subject:`Gumbo feedback: ${row.note.slice(0,60)}`,
    text:`${row.note}\n\nFrom: ${row.email??'(no email)'}${row.user_id?' (signed in)':''}\n${row.app_version} ${row.platform}\n${facts}`,
    html:`<p>${html(row.note).replace(/\n/g,'<br>')}</p><p><b>From:</b> ${html(row.email??'(no email)')}${row.user_id?' (signed in)':''}<br>${html(row.app_version)} ${html(row.platform)}</p><pre>${html(facts)}</pre>${row.email?'<p>Reply to this email to write back.</p>':''}`})});
  if(!response.ok)throw new Error(`Resend answered ${response.status}: ${(await response.text()).slice(0,200)}`);
 };
}
