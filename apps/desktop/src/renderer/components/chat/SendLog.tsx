import React,{useState} from 'react';
import {createPortal} from 'react-dom';
import {Flag,X,Check} from 'lucide-react';

/** Send log, under a finished request in the chat: the user says what went wrong (or nothing) and sends that request's log
 * (its calls and costs, the steps and notes the AI made, scene errors, the edit document; never the footage), so a slow,
 * costly or wrong edit can be traced. The reference that comes back is shown to quote. */
export function SendLog({turnId}:{turnId:string}){
 const [open,setOpen]=useState(false),[note,setNote]=useState(''),[state,setState]=useState<{busy?:boolean;sent?:string;error?:string}>({});
 const send=async()=>{setState({busy:true});try{const result=await window.dream.command<{reference:string}>({type:'account',action:'report',turnId,note:note.trim()});setState({sent:result.reference});}
  catch(e){setState({error:(e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/,'')});}};
 const close=()=>{setOpen(false);if(state.sent){setNote('');setState({});}};
 return <>
  <button type="button" className="turn-send-log" onClick={()=>setOpen(true)}><Flag size={12}/>Send log</button>
  {open&&createPortal(<div className="send-log-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget&&!state.busy)close();}}>
   <section className="send-log" role="dialog" aria-modal="true" aria-label="Send log">
    <button type="button" className="upgrade-close" aria-label="Close" onClick={close}><X size={16}/></button>
    {state.sent?<div className="send-log-done"><span><Check size={18}/></span><h3>Log sent</h3><p>Thanks. If you write to us about it, quote <b>{state.sent}</b>.</p><button type="button" className="settings-button-primary" onClick={close}>Done</button></div>:<>
     <h3>Send this request's log</h3>
     <p>It helps us see why an edit was slow, costly or wrong. It includes what the AI did and said, what each step cost, any scene errors and the edit's document. Your footage isn't sent.</p>
     <textarea autoFocus rows={4} maxLength={2000} placeholder="What went wrong? (optional)" value={note} onChange={e=>setNote(e.target.value)}/>
     {state.error&&<p className="send-log-error" role="alert">{state.error}</p>}
     <footer><button type="button" className="settings-button-secondary" onClick={close} disabled={state.busy}>Cancel</button><button type="button" className="settings-button-primary" onClick={()=>void send()} disabled={state.busy}>{state.busy?'Sending…':'Send log'}</button></footer>
    </>}
   </section>
  </div>,document.body)}
 </>;
}
