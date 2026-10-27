import {createRoot} from 'react-dom/client';
import {useEffect,useState} from 'react';
import '../shared/tokens.css';
import './popup.css';
import {Bowl} from '../shared/Bowl';
import {Sync} from './Sync';
import {ask,type AuthState,type Stats} from '../shared/protocol';
import {loadSettings,saveSettings,onSettings,activeOn,listensOn,blockedSite,siteOf,type Settings,type Surface} from '../shared/settings';

/** The toolbar popup: whether Gumbo is on here, pause, how Tab is doing on this computer, today's spend, what memory
 * keeps (and forgetting it), and the model for each surface. */
const models:{id:string;name:string}[]=[{id:'claude-haiku-5-5',name:'Claude Haiku 5.5'},{id:'claude-sonnet-5-5',name:'Claude Sonnet 5.5'},{id:'claude-opus-5-5',name:'Claude Opus 5.5'},{id:'deepseek-flash',name:'DeepSeek V4.1 Flash'},{id:'gpt-6.1-terra',name:'GPT-6.1 Terra'},{id:'groq-fast',name:'Llama on Groq (fastest)'}];
const surfaces:{id:Surface;name:string}[]=[{id:'tab',name:'Tab'},{id:'inline',name:'Ctrl+K'},{id:'notes',name:'Notes'},{id:'agent',name:'Agent'}];
const ms=(n?:number)=>n===undefined?'–':n<1000?`${Math.round(n)} ms`:`${(n/1000).toFixed(1)} s`;

function Popup(){
 const [auth,setAuth]=useState<AuthState>();const [settings,setSettings]=useState<Settings>();const [site,setSite]=useState('');
 const [stats,setStats]=useState<Stats>();const [meter,setMeter]=useState<any>();const [imported,setImported]=useState<any>();const [measuring,setMeasuring]=useState(false);const [spend,setSpend]=useState<{todayUsd?:number;thrifty?:boolean}>();const [kept,setKept]=useState<Record<string,number>>();const [tabId,setTabId]=useState<number>();const [heard,setHeard]=useState<string|undefined>();const [mic,setMic]=useState<PermissionState>('prompt');const [synced,setSynced]=useState(false);
 const refresh=()=>{void ask<Stats>({type:'stats'}).then(setStats);void ask({type:'memory.counts'}).then(setKept);};
 useEffect(()=>{
  void ask<AuthState>({type:'auth.state'}).then(setAuth);void loadSettings().then(setSettings);onSettings(setSettings);refresh();
  void ask({type:'spend'}).then(setSpend).catch(()=>{});void ask({type:'import.state'}).then(setImported).catch(()=>{});
  void chrome.tabs.query({active:true,currentWindow:true}).then(([tab])=>{setSite(siteOf(tab?.url??''));setTabId(tab?.id);if(tab?.id!==undefined)void ask<{here?:string}>({type:'listen.state',tabId:tab.id}).then(s=>setHeard(s?.here)).catch(()=>{});});
  void navigator.permissions.query({name:'microphone' as PermissionName}).then(p=>setMic(p.state)).catch(()=>{});
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
    {!!stats?.failures&&<Failures/>}
    {spend?.todayUsd!==undefined&&<p className="muted">Today's AI: ${spend.todayUsd.toFixed(2)}</p>}
    {spend?.thrifty&&<p className="muted">Saving credits: Tab guesses once you act, not ahead of you.</p>}
    <div className="row"><button className="link" disabled={measuring} onClick={()=>{setMeasuring(true);void ask({type:'meter.run'}).then(setMeter).finally(()=>setMeasuring(false));}}>{measuring?'Checking Tab on your writing…':'Check Tab on my writing'}</button></div>
    {meter&&('error' in meter?<p className="muted">{meter.error}</p>:<p className="muted">On your writing: shows {Math.round(meter.showRate*100)}% of the time, right {Math.round(meter.precision*100)}% when it does</p>)}
    {/* Drawing apps (Docs, Figma, boards) that ignore simulated clicks get real ones; Chrome asks once, and shows a bar while Tab acts. */}
    <div className="row"><button className="link" title="For documents, designs and boards drawn as pixels. Chrome shows a bar for a moment each time." onClick={()=>{
     if(settings.realInput){void saveSettings({realInput:false});return;}
     void chrome.permissions.request({permissions:['debugger']}).then(granted=>{if(granted)void saveSettings({realInput:true});});
    }}>{settings.realInput?'Stop using real clicks in drawing apps':'Use real clicks in drawing apps'}</button></div>
   </section>
   <section>
    <h2>Listening</h2>
    <p className="muted">{!settings.listen?'Off: videos and calls are not heard':!site||blocked?'Never on this page':!listensOn(settings,site)?`Not on ${site}`:heard?'Hearing this tab now':'Videos, talks and calls you play are heard and remembered, on this computer'}</p>
    <div className="row">
     {tabId!==undefined&&site&&!blocked&&<button className="link" onClick={()=>void ask<{listening:boolean;session?:string}>({type:'listen.toggle',tabId}).then(r=>setHeard(r?.listening?r.session:undefined))}>{heard?'Stop listening':'Listen to this tab'}</button>}
     <button className="link" onClick={()=>{void chrome.sidePanel.open({windowId:chrome.windows.WINDOW_ID_CURRENT}).catch(()=>{});window.close();}}>Captions and notes</button>
    </div>
    <div className="row">
     <button className="link" onClick={()=>void saveSettings({listen:!settings.listen})}>{settings.listen?'Stop hearing videos and calls':'Hear videos and calls'}</button>
     {site&&!blocked&&settings.listen&&<button className="link" onClick={()=>void saveSettings({listenOff:settings.listenOff.includes(site)?settings.listenOff.filter(s=>s!==site):[...settings.listenOff,site]})}>{settings.listenOff.includes(site)?`Listen on ${site}`:`Not on ${site}`}</button>}
     <button className="link" onClick={()=>{if(mic==='granted')void saveSettings({mic:!settings.mic});else void chrome.tabs.create({url:chrome.runtime.getURL('welcome.html#mic')});}}>{mic==='granted'&&settings.mic?'Leave my mic out of calls':'Hear my side of calls'}</button>
    </div>
   </section>
   <section>
    <h2>{synced?'Memory, on your computers':'Memory, on this computer only'}</h2>
    <p className="muted">{kept?`${kept.writing??0} pieces of your writing · ${kept.pages??0} pages · ${kept.media??0} meetings and videos`:'…'}</p>
    {imported&&<p className="muted">{imported.state==='done'?`Your history is in: ${imported.pages} pages, ${imported.visits} visits, ${imported.bookmarks} bookmarks`:imported.state==='running'?'Bringing in your history…':<button className="link" onClick={()=>{setImported({...imported,state:'running'});void ask({type:'import.run'}).then(setImported).catch(()=>{});}}>Bring in my history and bookmarks</button>}</p>}
    <div className="row">
     {site&&<button className="link" onClick={()=>void forget({site})}>Forget {site}</button>}
     <button className="link" onClick={()=>void forget({since:Date.now()-3_600_000})}>Forget the last hour</button>
     <button className="link danger" onClick={()=>{if(confirm(synced?'Forget everything Gumbo remembers, on all your computers?':'Forget everything Gumbo remembers on this computer?'))void forget({});}}>Forget everything</button>
    </div>
   </section>
   <Sync email={auth.email} onSynced={setSynced}/>
   <section>
    <h2>Models</h2>
    {surfaces.map(s=><label key={s.id} className="model"><span>{s.name}</span><select value={settings.models[s.id]} onChange={e=>void saveSettings({models:{...settings.models,[s.id]:e.target.value}})}>{models.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></label>)}
   </section>
   <footer><span className="muted">{auth.email}</span><button className="link" onClick={()=>void ask({type:'auth.signout'}).then(()=>setAuth({signedIn:false}))}>Sign out</button></footer>
  </>}
 </main>;
}
/** What went wrong lately (where, in which editor, what), kept on this computer, to read and to copy into a report. */
function Failures(){
 const [list,setList]=useState<{site:string;editor:string;what:string;detail:string;at:number}[]>();
 if(!list)return <button className="link" onClick={()=>void ask<any[]>({type:'failures'}).then(setList)}>What failed</button>;
 const text=list.map(f=>`${new Date(f.at).toLocaleString()} · ${f.site||'—'} · ${f.editor} · ${f.what}: ${f.detail}`).join('\n');
 return <div className="failures"><pre>{text||'Nothing.'}</pre><button className="link" onClick={()=>void navigator.clipboard.writeText(text)}>Copy</button></div>;
}
createRoot(document.getElementById('root')!).render(<Popup/>);
