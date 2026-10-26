import {useEffect,useState} from 'react';
import {ask} from '../shared/protocol';
import {suggestPassphrase,normalize,MIN_PASSPHRASE} from '../shared/sync-crypto';
import type {SyncState} from '../background/sync';

/** The popup's Sync section (background/sync.ts): turning sync on with a passphrase the user sets (the recovery note is
 * shown before anything is made, as the passphrase can't be shown again), entering it on another computer, and how sync
 * is going. */
type Account={profile:unknown|null}|{unavailable:true};
type Form='setup'|'join'|'startover';
const ago=(at:number)=>{const s=(Date.now()-at)/1000;return s<60?'just now':s<3600?`${Math.floor(s/60)} min ago`:s<86_400?`${Math.floor(s/3600)} h ago`:new Date(at).toLocaleDateString();};

export function Sync({email,onSynced}:{email?:string;onSynced:(on:boolean)=>void}){
 const [state,setState]=useState<SyncState>();const [account,setAccount]=useState<Account>();const [form,setForm]=useState<Form>();
 const refresh=()=>void ask<SyncState>({type:'sync.state'}).then(s=>{setState(s);onSynced(!!s?.on);}).catch(()=>{});
 const check=()=>void ask<any>({type:'sync.account'}).then(a=>setAccount(a&&!a.error&&'profile' in a?a:{unavailable:true}),()=>setAccount({unavailable:true}));
 useEffect(()=>{refresh();check();const timer=setInterval(refresh,1500);return()=>clearInterval(timer);},[]);
 if(!state)return null;
 const done=()=>{setForm(undefined);refresh();check();};
 if(form)return <section className="sync"><h2>Sync</h2><Passphrase form={form} email={email} onDone={done} onCancel={()=>setForm(undefined)} onForm={setForm}/></section>;
 if(!state.on){
  const exists=account&&'profile' in account&&!!account.profile;
  return <section className="sync">
   <h2>Sync</h2>
   {state.notice==='gone'&&<p className="muted">The synced copy was deleted on another computer, so sync is off here.</p>}
   {!account?<p className="muted">…</p>:'unavailable' in account?<p className="muted">Sync isn't available right now.</p>:exists?<>
    <p className="muted">Your memory syncs on another computer. Enter its passphrase to bring it here.</p>
    <div className="row"><button className="link" onClick={()=>setForm('join')}>Enter passphrase</button></div>
   </>:<>
    <p className="muted">Keep memory on your other computers too, encrypted with a passphrase only you know.</p>
    <div className="row"><button className="link" onClick={()=>setForm('setup')}>Turn on sync</button></div>
   </>}
  </section>;
 }
 if(state.changed)return <section className="sync"><h2>Sync</h2>
  <p className="muted">Your sync passphrase was changed on another computer. Enter the new one to keep syncing.</p>
  <div className="row"><button className="link" onClick={()=>setForm('join')}>Enter the new passphrase</button><button className="link" onClick={()=>void ask({type:'sync.off'}).then(done)}>Turn off here</button></div>
 </section>;
 return <section className="sync">
  <h2>Sync</h2>
  <p className="sync-status">{state.phase||!state.lastPull&&!state.lastPush?'Syncing…':`Synced ${ago(Math.max(state.lastPull??0,state.lastPush??0))}`}{!state.phase&&state.pending>0&&<span className="muted"> · {state.pending} to send</span>}</p>
  {state.error&&<p className="muted bad">Couldn't sync: {state.error}</p>}
  {state.full&&<p className="muted">The synced copy is full: what didn't fit stays on this computer.</p>}
  <p className="muted">End-to-end encrypted: only your passphrase opens it.</p>
  <div className="row">
   <button className="link" onClick={()=>void ask({type:'sync.now'}).then(refresh)}>Sync now</button>
   <button className="link" onClick={()=>void ask({type:'sync.off'}).then(done)}>Turn off on this computer</button>
   <button className="link danger" onClick={()=>{if(confirm('Delete the synced copy? Memory stays on each computer, and sync turns off on all of them.'))void ask({type:'sync.delete'}).then(done);}}>Delete synced copy</button>
  </div>
 </section>;
}

/** Setting a passphrase (with its recovery note), entering it, or setting a new one in place of a lost one. */
function Passphrase({form,email,onDone,onCancel,onForm}:{form:Form;email?:string;onDone:()=>void;onCancel:()=>void;onForm:(f:Form)=>void}){
 const [first,setFirst]=useState('');const [again,setAgain]=useState('');const [shown,setShown]=useState(false);
 const [note,setNote]=useState(false);const [busy,setBusy]=useState(false);const [error,setError]=useState<string>();const [copied,setCopied]=useState(false);
 const making=form!=='join';
 const submit=async()=>{
  setError(undefined);
  if(making&&!note){
   if(normalize(first).length<MIN_PASSPHRASE)return setError(`Use at least ${MIN_PASSPHRASE} characters.`);
   if(normalize(first)!==normalize(again))return setError('The two passphrases are not the same.');
   return setNote(true);
  }
  setBusy(true);
  try{
   const result=await ask<{ok?:true;error?:string;code?:string}>({type:form==='setup'?'sync.setup':form==='join'?'sync.join':'sync.startover',passphrase:first});
   if(result?.ok)return onDone();
   if(result?.code==='exists'){onForm('join');setFirst('');setAgain('');setNote(false);}
   setError(result?.error??'Sync could not start. Try again.');
  }catch(e){setError((e as Error).message);}finally{setBusy(false);}
 };
 const recovery=`Gumbo sync passphrase\n\n${normalize(first)}\n\nFor ${email??'your Gumbo account'}, set ${new Date().toLocaleDateString()}.\nGumbo never sees this passphrase and can't recover it. On another computer, sign in to Gumbo, open Gumbo from the toolbar and choose Enter passphrase. If it is lost, memory stays on your computers, and Start over sets a new passphrase.`;
 if(note)return <form onSubmit={e=>{e.preventDefault();void submit();}}>
  <p>Save this note first: it is the only way to read your synced memory on another computer.</p>
  <pre className="note" aria-label="Recovery note">{recovery}</pre>
  {error&&<p className="bad">{error}</p>}
  <div className="row">
   <button type="button" className="link" onClick={()=>void navigator.clipboard.writeText(recovery).then(()=>setCopied(true))}>{copied?'Copied':'Copy note'}</button>
   <button type="button" className="link" disabled={busy} onClick={()=>setNote(false)}>Back</button>
  </div>
  <button type="submit" className="primary" disabled={busy}>{busy?'Making your key…':form==='startover'?'Start over with this passphrase':'I saved it, turn on sync'}</button>
 </form>;
 return <form onSubmit={e=>{e.preventDefault();void submit();}}>
  <p className="muted">{form==='setup'?'Choose a passphrase. Gumbo never sees it and can’t reset it.':form==='join'?'The passphrase you set on your other computer.':'A new passphrase. The synced copy is deleted and made again from this computer; your other computers keep their memory and ask for the new passphrase.'}</p>
  <input type={shown?'text':'password'} aria-label="Sync passphrase" placeholder="Sync passphrase" autoFocus autoComplete={making?'new-password':'current-password'} value={first} onChange={e=>setFirst(e.target.value)}/>
  {making&&<input type={shown?'text':'password'} aria-label="Sync passphrase again" placeholder="The same again" autoComplete="new-password" value={again} onChange={e=>setAgain(e.target.value)}/>}
  {error&&<p className="bad">{error}</p>}
  <div className="row">
   {making&&<button type="button" className="link" onClick={()=>{const p=suggestPassphrase();setFirst(p);setAgain(p);setShown(true);}}>Make one for me</button>}
   <button type="button" className="link" onClick={()=>setShown(!shown)}>{shown?'Hide':'Show'}</button>
   {form==='join'&&<button type="button" className="link" onClick={()=>{onForm('startover');setFirst('');setError(undefined);}}>Forgot it? Start over</button>}
   <button type="button" className="link" onClick={onCancel}>Cancel</button>
  </div>
  <button type="submit" className="primary" disabled={busy||!first}>{busy?'Opening your memory…':making?'Continue':'Bring my memory here'}</button>
 </form>;
}
