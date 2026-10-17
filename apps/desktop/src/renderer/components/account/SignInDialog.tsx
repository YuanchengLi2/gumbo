import React,{useEffect,useState} from 'react';
import {X,ExternalLink} from 'lucide-react';
import {signInFinished} from '../../account';

/** Sign in to Gumbo happens in the browser: this asks for it, opens Gumbo's sign-in page (Google or an emailed link),
 * and waits; the app is signed in when the browser returns, and whatever needed sign-in carries on. Shown whenever
 * something needs Gumbo AI and no one is signed in, and from Settings > Account. */
export function SignInDialog(p:{onClose:()=>void}){
 const [url,setUrl]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[copied,setCopied]=useState(false);
 const done=(signedIn:boolean)=>{signInFinished(signedIn);p.onClose();};
 useEffect(()=>{const off=window.dream.onEvent(event=>{if(event.type==='account.signed_in')done(true);if(event.type==='account.error'){setUrl(null);setError(String((event.payload as {message?:string})?.message??'Sign-in failed.'));}});
  // Esc closes sign-in first, before anything under it (see Settings).
  const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();done(false);}};window.addEventListener('keydown',key,true);return()=>{off();window.removeEventListener('keydown',key,true);};},[]);
 const open=async()=>{setBusy(true);setError(null);setCopied(false);try{const result=await window.dream.command<{url:string}>({type:'account',action:'browser'});setUrl(result.url);}catch(e){setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/,''));}finally{setBusy(false);}};
 const copy=async()=>{if(!url)return;try{await navigator.clipboard.writeText(url);setCopied(true);}catch{setError('Could not copy the link.');}};
 return <div className="dialog-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)done(false);}}>
  <section className="dialog sign-in" role="dialog" aria-modal="true" aria-label="Sign in to Gumbo">
   <button type="button" className="sign-in-close" aria-label="Close sign-in" onClick={()=>done(false)}><X size={18}/></button>
   <h2>{url?'Continue in your browser':'Sign in to Gumbo'}</h2>
   <p className="sign-in-lead">{url?'Sign in on the page that opened in your browser, with Google or your email. Gumbo signs in as soon as you finish.':'Sign in to use Gumbo AI. Your browser opens to sign in with Google or your email; new here, it creates your account.'}</p>
   {error&&<p className="sign-in-error" role="alert">{error}</p>}
   {!url?<button type="button" className="sign-in-primary" disabled={busy} onClick={()=>void open()}><ExternalLink size={15}/>{busy?'Opening…':'Sign in with your browser'}</button>
    :<><div className="sign-in-waiting" role="status"><span className="sign-in-spinner" aria-hidden="true"/>Waiting for you to sign in…</div>
     <div className="sign-in-links">
      <button type="button" disabled={busy} onClick={()=>void open()}>Open the page again</button>
      <button type="button" onClick={()=>void copy()}>{copied?'Link copied':'Copy the link'}</button>
     </div></>}
  </section>
 </div>;
}
