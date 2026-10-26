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
  <section className="try">
   <h2>Try it here</h2>
   <textarea id="try" placeholder="Write a note to a friend…" spellCheck={false}/>
   <div className="keys"><span><kbd>Tab</kbd> takes the suggestion</span><span><kbd>Ctrl</kbd>+<kbd>→</kbd> one word</span><span><kbd>Esc</kbd> dismisses</span><span>Select text, then <kbd>Ctrl</kbd>+<kbd>K</kbd></span></div>
  </section>
 </main>;
}
createRoot(document.getElementById('root')!).render(<Welcome/>);
// Tab and Ctrl+K work on this page too, so they can be tried right here.
start(window);
