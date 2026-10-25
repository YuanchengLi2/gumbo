import {createRoot} from 'react-dom/client';
import {useEffect,useState} from 'react';
import '../shared/tokens.css';
import './popup.css';
import {Bowl} from '../shared/Bowl';
import {ask,type AuthState,type Stats} from '../shared/protocol';
import {loadSettings,saveSettings,onSettings,activeOn,blockedSite,siteOf,type Settings,type Surface} from '../shared/settings';

/** The toolbar popup: whether Gumbo is on here, pause, how Tab is doing on this computer, today's spend, what memory
 * keeps (and forgetting it), and the model for each surface. */
const models:{id:string;name:string}[]=[{id:'claude-haiku-5-5',name:'Claude Haiku 5.5'},{id:'claude-sonnet-5-5',name:'Claude Sonnet 5.5'},{id:'claude-opus-5-5',name:'Claude Opus 5.5'},{id:'deepseek-flash',name:'DeepSeek V4.1 Flash'}];
const surfaces:{id:Surface;name:string}[]=[{id:'tab',name:'Tab'},{id:'inline',name:'Ctrl+K'},{id:'notes',name:'Notes'},{id:'agent',name:'Agent'}];
const ms=(n?:number)=>n===undefined?'–':n<1000?`${Math.round(n)} ms`:`${(n/1000).toFixed(1)} s`;

function Popup(){
 const [auth,setAuth]=useState<AuthState>();const [settings,setSettings]=useState<Settings>();const [site,setSite]=useState('');
 const [stats,setStats]=useState<Stats>();const [spend,setSpend]=useState<{todayUsd?:number}>();const [kept,setKept]=useState<Record<string,number>>();
 const refresh=()=>{void ask<Stats>({type:'stats'}).then(setStats);void ask({type:'memory.counts'}).then(setKept);};
 useEffect(()=>{
  void ask<AuthState>({type:'auth.state'}).then(setAuth);void loadSettings().then(setSettings);onSettings(setSettings);refresh();
  void ask({type:'spend'}).then(setSpend).catch(()=>{});
  void chrome.tabs.query({active:true,currentWindow:true}).then(([tab])=>setSite(siteOf(tab?.url??'')));
 },[]);
 if(!auth||!settings)return null;
 const paused=settings.pausedUntil>Date.now(),on=activeOn(settings,site),blocked=site&&blockedSite(site),off=settings.siteOff.includes(site);
 const toggleSite=()=>void saveSettings({siteOff:off?settings.siteOff.filter(s=>s!==site):[...settings.siteOff,site]});
 const forget=async(scope:{site?:string;since?:number})=>{await ask({type:'memory.forget',...scope});refresh();};
 return <main>
  <header><Bowl size={22}/><h1>Gumbo</h1>
   <label className="switch" title={settings.enabled?'Turn Gumbo off':'Turn Gumbo on'}><input type="checkbox" checked={settings.enabled} onChange={e=>void saveSettings({enabled:e.target.checked})}/><span/></label>
  </header>
  {!auth.signedIn&&<section className="signin"><p>Sign in with your Gumbo account to turn on Tab, Ctrl+K and memory.</p><button className="primary" onClick={()=>void ask({type:'auth.signin'}).then(()=>window.close())}>Sign in</button></section>}
  {auth.signedIn&&<>
   <section>
    <p className="status">{!settings.enabled?'Off everywhere':paused?`Paused until ${new Date(settings.pausedUntil).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'})}`:blocked?`Never on ${site}`:on?<>On here{site&&<span className="muted"> · {site}</span>}</>:`Off on ${site}`}</p>
    <div className="row">
     {site&&!blocked&&<button className="link" onClick={toggleSite}>{off?'Turn on for this site':'Turn off for this site'}</button>}
     <button className="link" onClick={()=>void saveSettings({pausedUntil:paused?0:Date.now()+3_600_000})}>{paused?'Resume':'Pause for an hour'}</button>
    </div>
   </section>
   <section>
    <h2>Tab on this computer</h2>
    <p>First word in {ms(stats?.tab.p50)} <span className="muted">typical · {ms(stats?.tab.p90)} at worst for 9 in 10</span></p>
    <p>{stats?.accepted??0} taken of {stats?.shown??0} shown{stats?.dismissed?` · ${stats.dismissed} dismissed`:''}{stats?.failures?<span className="bad"> · {stats.failures} failed</span>:''}</p>
    {spend?.todayUsd!==undefined&&<p className="muted">Today's AI: ${spend.todayUsd.toFixed(2)}</p>}
   </section>
   <section>
    <h2>Memory, on this computer only</h2>
    <p className="muted">{kept?`${kept.writing??0} pieces of your writing · ${kept.pages??0} pages · ${kept.media??0} meetings and videos`:'…'}</p>
    <div className="row">
     {site&&<button className="link" onClick={()=>void forget({site})}>Forget {site}</button>}
     <button className="link" onClick={()=>void forget({since:Date.now()-3_600_000})}>Forget the last hour</button>
     <button className="link danger" onClick={()=>{if(confirm('Forget everything Gumbo remembers on this computer?'))void forget({});}}>Forget everything</button>
    </div>
   </section>
   <section>
    <h2>Models</h2>
    {surfaces.map(s=><label key={s.id} className="model"><span>{s.name}</span><select value={settings.models[s.id]} onChange={e=>void saveSettings({models:{...settings.models,[s.id]:e.target.value}})}>{models.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label>)}
   </section>
   <footer><span className="muted">{auth.email}</span><button className="link" onClick={()=>void ask({type:'auth.signout'}).then(()=>setAuth({signedIn:false}))}>Sign out</button></footer>
  </>}
 </main>;
}
createRoot(document.getElementById('root')!).render(<Popup/>);
