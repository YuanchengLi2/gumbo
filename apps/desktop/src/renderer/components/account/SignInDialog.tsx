import React,{useEffect,useRef,useState} from 'react';
import {X} from 'lucide-react';
import {signInFinished} from '../../account';

/** Sign in to Figjam: Google, or an email with an 8-digit code to type here (the same email has a link that signs in
 * too). A new email address gets a new account. Shown whenever something needs Figjam AI and no one is signed in, and
 * from Settings > Account. */
export function SignInDialog(p:{onClose:()=>void}){
 const [email,setEmail]=useState(''),[sent,setSent]=useState<string|null>(null),[code,setCode]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[wait,setWait]=useState(0),codeInput=useRef<HTMLInputElement>(null);
 const done=(signedIn:boolean)=>{signInFinished(signedIn);p.onClose();};
 useEffect(()=>{const off=window.dream.onEvent(event=>{if(event.type==='account.signed_in')done(true);if(event.type==='account.error'){setBusy(false);setError(String((event.payload as {message?:string})?.message??'Sign-in failed.'));}});
  // Esc closes sign-in first, before anything under it (see Settings).
  const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();done(false);}};window.addEventListener('keydown',key,true);return()=>{off();window.removeEventListener('keydown',key,true);};},[]);
 useEffect(()=>{if(!wait)return;const timer=setTimeout(()=>setWait(w=>Math.max(0,w-1)),1000);return()=>clearTimeout(timer);},[wait]);
 useEffect(()=>{if(sent)codeInput.current?.focus();},[sent]);
 const run=async(work:()=>Promise<unknown>)=>{setBusy(true);setError(null);try{await work();}catch(e){setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/,''));}finally{setBusy(false);}};
 const send=()=>run(async()=>{const result=await window.dream.command<{email:string}>({type:'account',action:'send_code',email});setSent(result.email);setCode('');setWait(60);});
 const verify=()=>run(async()=>{await window.dream.command({type:'account',action:'verify_code',email:sent!,code});done(true);});
 const google=()=>run(async()=>{await window.dream.command({type:'account',action:'google'});});
 return <div className="dialog-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)done(false);}}>
  <section className="dialog sign-in" role="dialog" aria-modal="true" aria-label="Sign in to Figjam">
   <button type="button" className="sign-in-close" aria-label="Close sign-in" onClick={()=>done(false)}><X size={18}/></button>
   <h2>Sign in to Figjam</h2>
   <p className="sign-in-lead">{sent?<>We sent a code to <strong>{sent}</strong>. Type it below, or open the link in the email on this computer.</>:'Sign in to use Figjam AI. New here? This creates your account.'}</p>
   {error&&<p className="sign-in-error" role="alert">{error}</p>}
   {!sent?<>
    <button type="button" className="sign-in-google" disabled={busy} onClick={()=>void google()}><GoogleMark/>Continue with Google</button>
    <div className="sign-in-or"><span>or</span></div>
    <form onSubmit={e=>{e.preventDefault();void send();}}>
     <label className="sign-in-label" htmlFor="sign-in-email">Email</label>
     <input id="sign-in-email" className="sign-in-input" type="email" autoComplete="email" autoFocus required value={email} placeholder="you@example.com" onChange={e=>setEmail(e.target.value)}/>
     <button type="submit" className="sign-in-primary" disabled={busy||!email.trim()}>{busy?'Sending…':'Email me a code'}</button>
    </form>
   </>:<form onSubmit={e=>{e.preventDefault();void verify();}}>
    <label className="sign-in-label" htmlFor="sign-in-code">Code</label>
    <input id="sign-in-code" ref={codeInput} className="sign-in-input sign-in-code" inputMode="numeric" autoComplete="one-time-code" maxLength={12} value={code} placeholder="12345678" onChange={e=>setCode(e.target.value.replace(/[^\d\s]/g,''))}/>
    <button type="submit" className="sign-in-primary" disabled={busy||code.replace(/\D/g,'').length<6}>{busy?'Signing in…':'Sign in'}</button>
    <div className="sign-in-links">
     <button type="button" disabled={busy||wait>0} onClick={()=>void send()}>{wait?`Send a new code in ${wait}s`:'Send a new code'}</button>
     <button type="button" disabled={busy} onClick={()=>{setSent(null);setError(null);}}>Use a different email</button>
    </div>
   </form>}
  </section>
 </div>;
}
/** Google's "G", in its own colours (the one mark in the app that is not black and white). */
function GoogleMark(){return <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.9 6.1C12.5 13.6 17.8 9.5 24 9.5z"/><path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v8.5h12.4c-.5 2.9-2.1 5.3-4.6 7l7.1 5.5c4.2-3.9 7.2-9.6 7.2-16.5z"/><path fill="#FBBC05" d="M10.6 28.6c-.5-1.4-.8-3-.8-4.6s.3-3.2.8-4.6l-7.9-6.1C1 16.6 0 20.2 0 24s1 7.4 2.7 10.7l7.9-6.1z"/><path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.1-5.5c-2 1.4-4.6 2.2-8.8 2.2-6.2 0-11.5-4.1-13.4-9.8l-7.9 6.1C6.6 42.6 14.6 48 24 48z"/></svg>;}
