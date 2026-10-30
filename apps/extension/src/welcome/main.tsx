import {createRoot} from 'react-dom/client';
import {useEffect,useState} from 'react';
import '../shared/tokens.css';
import './welcome.css';
import {Bowl} from '../shared/Bowl';
import {ask,type AuthState} from '../shared/protocol';
import {start} from '../content/engine';
import {saveSettings} from '../shared/settings';

/** The first page Gumbo opens: sign in, then try Tab and Ctrl+K right here. It also says how a sign-in ended. */
function Welcome(){
 const query=new URLSearchParams(location.search),error=query.get('error');
 const [auth,setAuth]=useState<AuthState>();
 useEffect(()=>{void ask<AuthState>({type:'auth.state'}).then(setAuth);},[]);
 if(!auth)return null;
 return <main>
  <Bowl size={44}/>
  {auth.signedIn?<>
   <h1>Gumbo is ready.</h1>
   <p className="lede">Start typing anywhere and Gumbo finishes your sentence in grey. It remembers what you read, write and hear, on this computer only.</p>
  </>:<>
   <h1>Gumbo, in every site you use.</h1>
   <p className="lede">Tab finishes what you type. Ctrl+K rewrites, answers and acts right where you are. Your memory stays on this computer; only the words a request needs go to the AI.</p>
   {error&&<p className="error">{error}</p>}
   <button className="primary" onClick={()=>void ask({type:'auth.signin'})}>Sign in with your Gumbo account</button>
  </>}
  {auth.signedIn&&<Bring/>}
  <Hear/>
  <section className="try">
   <h2>Try it here</h2>
   <textarea id="try" placeholder="Write a note to a friend…" spellCheck={false}/>
   <div className="keys"><span><kbd>Tab</kbd> takes the suggestion</span><span><kbd>Ctrl</kbd>+<kbd>→</kbd> one word</span><span><kbd>Esc</kbd> dismisses</span><span>Select text, then <kbd>Ctrl</kbd>+<kbd>K</kbd></span></div>
  </section>
 </main>;
}
/** What the user already has: history teaches Tab their habits on its own after sign-in; another assistant's memory is
 * pasted here. */
function Bring(){
 const [state,setState]=useState<any>();const [text,setText]=useState('');const [done,setDone]=useState<string>();
 useEffect(()=>{const poll=()=>void ask({type:'import.state'}).then(setState).catch(()=>{});poll();const t=setInterval(poll,2000);return()=>clearInterval(t);},[]);
 return <section className="bring">
  <h2>Bring in what you already have</h2>
  <p>{state?.state==='done'?`Tab learned where you usually go next from ${state.visits} visits in your history.`:state?.state==='running'?`Learning from your history… ${state.pages} pages so far.`:'Tab learns where you usually go next from your browsing history, on this computer only. Memory keeps only what you see.'}</p>
  <p>Ask ChatGPT or Claude "What do you remember about me?" and paste the answer here:</p>
  <textarea value={text} onChange={e=>setText(e.target.value)} placeholder="Paste what your other assistant remembers about you" spellCheck={false}/>
  <div className="row"><button className="secondary" disabled={!text.trim()} onClick={()=>void ask<any>({type:'import.memory',text}).then(r=>{setDone(`Kept ${r.notes} things about you${r.facts?.name?`, ${r.facts.name}`:''}.`);setText('');})}>Bring it in</button>{done&&<span className="muted">{done}</span>}</div>
 </section>;
}
/** Meetings: what a call plays is heard on its own; the user's own side needs the microphone, allowed once here. */
function Hear(){
 const [state,setState]=useState<PermissionState|'asking'>('prompt');
 useEffect(()=>{void navigator.permissions.query({name:'microphone' as PermissionName}).then(p=>{setState(p.state);p.onchange=()=>setState(p.state);}).catch(()=>{});if(location.hash==='#mic')document.getElementById('mic')?.scrollIntoView({block:'center'});},[]);
 const allow=async()=>{setState('asking');try{const stream=await navigator.mediaDevices.getUserMedia({audio:true});stream.getTracks().forEach(t=>t.stop());await saveSettings({mic:true});setState('granted');}catch{setState('denied');}};
 return <section className="bring" id="mic">
  <h2>Meetings and videos</h2>
  <p>What plays in a tab (a video, a talk, the other side of a call) is heard and written down on this computer, with who said what. The sound itself is never kept, and a small pill shows while Gumbo listens.</p>
  <p>{state==='granted'?'Gumbo hears your side of calls too, as "You".':state==='denied'?'The microphone is blocked for Gumbo. Allow it from the icon in the address bar, then come back.':'For your own side of a call, Gumbo needs the microphone (only while a call is on):'}</p>
  {state!=='granted'&&state!=='denied'&&<div className="row"><button className="secondary" disabled={state==='asking'} onClick={()=>void allow()}>Let Gumbo hear my side of calls</button></div>}
 </section>;
}
createRoot(document.getElementById('root')!).render(<Welcome/>);
// Tab and Ctrl+K work on this page too, so they can be tried right here.
start(window);
