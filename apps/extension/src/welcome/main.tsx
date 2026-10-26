import {createRoot} from 'react-dom/client';
import {useEffect,useState} from 'react';
import '../shared/tokens.css';
import './welcome.css';
import {Bowl} from '../shared/Bowl';
import {ask,type AuthState} from '../shared/protocol';
import {start} from '../content/engine';

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
  <section className="try">
   <h2>Try it here</h2>
   <textarea id="try" placeholder="Write a note to a friend…" spellCheck={false}/>
   <div className="keys"><span><kbd>Tab</kbd> takes the suggestion</span><span><kbd>Ctrl</kbd>+<kbd>→</kbd> one word</span><span><kbd>Esc</kbd> dismisses</span><span>Select text, then <kbd>Ctrl</kbd>+<kbd>K</kbd></span></div>
  </section>
 </main>;
}
/** What the user already has: history and bookmarks come in on their own after sign-in; another assistant's memory is
 * pasted here. */
function Bring(){
 const [state,setState]=useState<any>();const [text,setText]=useState('');const [done,setDone]=useState<string>();
 useEffect(()=>{const poll=()=>void ask({type:'import.state'}).then(setState).catch(()=>{});poll();const t=setInterval(poll,2000);return()=>clearInterval(t);},[]);
 return <section className="bring">
  <h2>Bring in what you already have</h2>
  <p>{state?.state==='done'?`Your history is in: ${state.pages} pages and ${state.bookmarks} bookmarks. Tab already knows where you usually go next.`:state?.state==='running'?`Bringing in your history… ${state.pages} pages so far.`:'Your browsing history and bookmarks come in on their own, on this computer only.'}</p>
  <p>Ask ChatGPT or Claude "What do you remember about me?" and paste the answer here:</p>
  <textarea value={text} onChange={e=>setText(e.target.value)} placeholder="Paste what your other assistant remembers about you" spellCheck={false}/>
  <div className="row"><button className="secondary" disabled={!text.trim()} onClick={()=>void ask<any>({type:'import.memory',text}).then(r=>{setDone(`Kept ${r.notes} things about you${r.facts?.name?`, ${r.facts.name}`:''}.`);setText('');})}>Bring it in</button>{done&&<span className="muted">{done}</span>}</div>
 </section>;
}
createRoot(document.getElementById('root')!).render(<Welcome/>);
// Tab and Ctrl+K work on this page too, so they can be tried right here.
start(window);
