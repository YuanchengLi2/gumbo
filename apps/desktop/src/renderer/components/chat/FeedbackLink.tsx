import React,{useEffect,useRef,useState} from 'react';
import {useEditor} from '../../store/editor';
import {useAccount} from '../../account';

/** "Stumped or broken? Let me know", always under the prompt box: one line about what failed and, if they like, an email
 * to hear back on. It needs no account. It sends what Gumbo was doing too (the last request, how it ended, the model),
 * so a few words are enough to find the problem (gateway feedback.ts). */
export function FeedbackLink(){
 const [open,setOpen]=useState(false),[note,setNote]=useState(''),[email,setEmail]=useState(''),[state,setState]=useState<'idle'|'sending'|'sent'>('idle'),[error,setError]=useState<string|null>(null);
 const account=useAccount(),box=useRef<HTMLDivElement>(null),field=useRef<HTMLTextAreaElement>(null);
 useEffect(()=>{if(account?.email&&!email)setEmail(account.email);},[account?.email]);
 useEffect(()=>{if(!open)return;field.current?.focus();
  const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.stopPropagation();setOpen(false);}},away=(e:MouseEvent)=>{if(!box.current?.contains(e.target as Node))setOpen(false);};
  window.addEventListener('keydown',key,true);document.addEventListener('mousedown',away);return()=>{window.removeEventListener('keydown',key,true);document.removeEventListener('mousedown',away);};},[open]);
 const send=async()=>{if(!note.trim()||state==='sending')return;setState('sending');setError(null);
  const {project,model,permission,layout,route}=useEditor.getState(),last=[...project?.messages??[]].reverse().find(m=>m.role==='user');
  const context={route,layout,model,permission,aiStatus:project?.aiStatus??'',lastRequest:(last?.text??'').slice(0,500),lastTurnId:last?.turnId??'',clips:project?.footage.assets.length??0};
  try{await window.dream.command({type:'account',action:'feedback',note:note.trim(),email:email.trim()||undefined,context});setState('sent');setNote('');setTimeout(()=>{setOpen(false);setState('idle');},2600);}
  catch(e){setState('idle');setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/,''));}};
 return <div className="feedback-anchor" ref={box}>
  <button type="button" className="feedback-link" aria-expanded={open} onClick={()=>{setOpen(!open);setError(null);}}>Stumped or broken? Let me know</button>
  {open&&<form className="feedback-box" aria-label="Send feedback" onSubmit={e=>{e.preventDefault();void send();}}>
   {state==='sent'?<p className="feedback-thanks" role="status">Thanks, got it. I'll look into it{email.trim()?' and write back':''}.</p>:<>
    <textarea ref={field} value={note} maxLength={2000} rows={3} aria-label="What failed" placeholder="What prompt or action just failed?" onChange={e=>setNote(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();void send();}}}/>
    <input type="email" value={email} aria-label="Your email (optional)" placeholder="Email (optional, I'll tell you when it's fixed)" onChange={e=>setEmail(e.target.value)}/>
    {error&&<p className="feedback-error" role="alert">{error}</p>}
    <div className="feedback-actions"><button type="button" onClick={()=>setOpen(false)}>Cancel</button><button type="submit" className="feedback-send" disabled={!note.trim()||state==='sending'}>{state==='sending'?'Sending…':'Send'}</button></div></>}
  </form>}
 </div>;
}
