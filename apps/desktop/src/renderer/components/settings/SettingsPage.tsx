import React,{useEffect,useRef,useState} from 'react';
import {X,User,Sun,Moon,Monitor,KeyRound,Gauge,Sparkles,Clapperboard,ShieldCheck,Keyboard,Info} from 'lucide-react';
import type {AppSettings,RuntimeStatus} from '@dream/contracts';
import {useTheme,setThemeChoice,type ThemeChoice} from '../../theme';
import {shortcutHints} from '../../shortcuts';
import {refreshProviders} from '../../models';
import {useAccount,requireSignIn,signedOut} from '../../account';
import {UsagePage,PlanPage} from './BillingPages';
import {ProfileActivity} from './ProfileActivity';
import {profileChanged} from '../../profile';

/** Settings as a page of its own, laid out as Claude's: sections in a sidebar on the left, the chosen one on the right, as
 * plain rows (a label, what it does, its control). Profile shows your token activity and what the AI knows about you
 * (settings.json); Plan and Usage are billing (paying is on Stripe's page); Privacy says plainly what happens to your things. */
export type SettingsSection='profile'|'appearance'|'account'|'plan'|'usage'|'export'|'privacy'|'shortcuts'|'about';
const sections:[SettingsSection,string,typeof User][]=[['profile','Profile',User],['appearance','Appearance',Sun],['account','Account',KeyRound],['plan','Plan',Sparkles],['usage','Usage',Gauge],['export','Export',Clapperboard],['privacy','Privacy',ShieldCheck],['shortcuts','Shortcuts',Keyboard],['about','About',Info]];
const themes:[ThemeChoice,string,typeof Sun][]=[['light','Light',Sun],['dark','Dark',Moon],['system','System',Monitor]];
const shortcuts:[string,string][]=[[shortcutHints.chat+' or /','Type in the chat'],[shortcutHints.mode,'Edit, Plan or Ask'],['Ctrl+1 / 2 / 3','Edit / Plan / Ask'],[shortcutHints.model,'Next model'],['Space','Play or pause'],['Ctrl+B','Split at playhead'],['Ctrl+D','Duplicate'],['Delete','Delete selection'],['Ctrl+Z','Undo'],['Esc','Leave fullscreen or close Settings']];

/** One setting: what it is and what it does on the left, its control on the right. */
function Row(p:{label:string;help?:React.ReactNode;children?:React.ReactNode;stacked?:boolean}){
 return <div className={'settings-row'+(p.stacked?' stacked':'')}><div className="settings-row-text"><div className="settings-row-label">{p.label}</div>{p.help&&<div className="settings-row-help">{p.help}</div>}</div>{p.children&&<div className="settings-row-control">{p.children}</div>}</div>;
}
function Segments<T extends string>(p:{label:string;value:T;options:readonly (readonly [T,string])[];onChange:(value:T)=>void}){
 return <div className="settings-segments" role="radiogroup" aria-label={p.label}>{p.options.map(([id,label])=><button key={id} type="button" role="radio" aria-checked={p.value===id} className={p.value===id?'selected':''} onClick={()=>p.onChange(id)}>{label}</button>)}</div>;
}
function Switch(p:{label:string;checked:boolean;disabled?:boolean;onChange:(on:boolean)=>void}){
 return <button type="button" role="switch" aria-label={p.label} aria-checked={p.checked} disabled={p.disabled} className={'settings-switch'+(p.checked?' on':'')} onClick={()=>p.onChange(!p.checked)}><span/></button>;
}

function Profile(p:{settings:AppSettings;save:(patch:Partial<AppSettings>)=>void}){
 // The fields are the user's while the page is open: a save coming back never resets them (that lost what was typed in
 // the next field while the last one saved), and each save sends only the field that changed.
 const [draft,setDraft]=useState(p.settings.profile);
 const commit=(key:keyof AppSettings['profile'])=>{if(draft[key]!==p.settings.profile[key])p.save({profile:{[key]:draft[key]}} as Partial<AppSettings>);};
 return <>
  <ProfileActivity/>
  <h3 className="settings-subhead">How Gumbo knows you</h3>
  <p className="settings-lead">Gumbo's AI reads this with every request, in every project, so each edit starts from your own style.</p>
  <Row label="Name" help="What Gumbo calls you."><input className="settings-input" aria-label="Name" value={draft.name} maxLength={80} placeholder="Your name" onChange={e=>setDraft({...draft,name:e.target.value})} onBlur={()=>commit('name')}/></Row>
  <Row label="What you make" help="The kind of videos you make."><input className="settings-input" aria-label="What you make" value={draft.makes} maxLength={300} placeholder="Travel vlogs, anime edits, explainer shorts" onChange={e=>setDraft({...draft,makes:e.target.value})} onBlur={()=>commit('makes')}/></Row>
  <Row label="Your style" help="How you like your videos: Gumbo follows it unless a request says otherwise." stacked><textarea className="settings-input settings-textarea" aria-label="Your style" value={draft.style} maxLength={2000} rows={5} placeholder="Plain white captions, fast cuts on the beat, no zoom effects, music quiet under speech" onChange={e=>setDraft({...draft,style:e.target.value})} onBlur={()=>commit('style')}/></Row>
 </>;
}

function Account(){
 const account=useAccount(),[busy,setBusy]=useState(false);
 // No system confirm: signing out loses nothing (projects stay here, signing in again is a code away), and the native
 // dialog could leave the window without the keyboard afterwards.
 const signOut=async()=>{setBusy(true);try{await window.dream.command({type:'account',action:'signout'});signedOut();}finally{setBusy(false);}};
 const signedIn=!!account?.signedIn;
 return <>
  <Row label={signedIn?'Signed in as':'Not signed in'} help={!account?'Checking…':signedIn?undefined:'Sign in with Google or your email to use Gumbo AI. Your projects stay on this computer either way.'}>{signedIn&&<span className="settings-value">{account!.email}</span>}</Row>
  <Row label={signedIn?'Sign out':'Sign in'} help={signedIn?'Your projects stay on this computer; Gumbo AI needs you to sign in again.':'New here? Signing in creates your account.'}>
   {signedIn?<button type="button" className="settings-button-secondary" disabled={busy} onClick={()=>void signOut()}>Sign out</button>:<button type="button" className="settings-button-primary" onClick={()=>void requireSignIn()}>Sign in</button>}
  </Row>
 </>;
}

type ExportDefaults={resolution:'source'|'480'|'720'|'1080'|'1440'|'2160';quality:'lower'|'recommended'|'higher';codec:'h264'|'hevc';format:'mp4'|'mov';fps:'source'|24|25|30|50|60;audio:boolean};
const exportDefaults=():ExportDefaults=>{let saved:Partial<ExportDefaults>={};try{saved=JSON.parse(localStorage.getItem('dream-export')??'{}');}catch{}return{resolution:'source',quality:'recommended',codec:'h264',format:'mp4',fps:'source',audio:false,...saved};};
function Export(){
 const [c,setC]=useState(exportDefaults);
 const set=(patch:Partial<ExportDefaults>)=>setC(old=>{const next={...old,...patch};try{localStorage.setItem('dream-export',JSON.stringify({...JSON.parse(localStorage.getItem('dream-export')??'{}'),...next}));}catch{}return next;});
 const select=<K extends keyof ExportDefaults>(key:K,label:string,options:[ExportDefaults[K],string][])=><select className="settings-select" aria-label={label} value={String(c[key])} onChange={e=>{const option=options.find(([v])=>String(v)===e.target.value);if(option)set({[key]:option[0]} as Partial<ExportDefaults>);}}>{options.map(([v,l])=><option key={String(v)} value={String(v)}>{l}</option>)}</select>;
 return <>
  <p className="settings-lead">What the Export window starts with. You can still change any of it when you export.</p>
  <Row label="Resolution" help="Never above the project's own size.">{select('resolution','Resolution',[['source','Project size'],['480','480p'],['720','720p'],['1080','1080p'],['1440','2K'],['2160','4K']])}</Row>
  <Row label="Quality" help="Higher looks better and makes bigger files.">{select('quality','Quality',[['lower','Lower'],['recommended','Recommended'],['higher','Higher']])}</Row>
  <Row label="Codec" help="H.264 plays everywhere; HEVC makes smaller files.">{select('codec','Codec',[['h264','H.264'],['hevc','HEVC']])}</Row>
  <Row label="Format">{select('format','Format',[['mp4','MP4'],['mov','MOV']])}</Row>
  <Row label="Frame rate">{select('fps','Frame rate',[['source','Project rate'],[24,'24'],[25,'25'],[30,'30'],[50,'50'],[60,'60']])}</Row>
  <Row label="Also export the sound" help="Saves the audio as its own file beside the video."><Switch label="Also export the sound" checked={c.audio} onChange={audio=>set({audio})}/></Row>
 </>;
}

/** Privacy: what Gumbo is and what happens to your things, plainly. The one switch is helping improve Gumbo
 * (renderer/improve.ts), asked in the onboarding. */
function Privacy(){
 const [improve,setImprove]=useState<boolean|undefined>();
 useEffect(()=>{void window.dream.settings().then(s=>setImprove(!!(s as {improve?:boolean}).improve),()=>{});},[]);
 const change=(on:boolean)=>{setImprove(on);void window.dream.saveSettings({improve:on} as never).catch(()=>setImprove(!on));};
 return <div className="privacy">
  <p className="settings-lead">Gumbo is a video editor that edits with AI. Your projects live on your computer; the AI runs in the cloud.</p>
  <section><h3>What stays on your computer</h3><p>Your projects, footage, music and exports. Gumbo keeps them in your Projects folder and never uploads them to store them.</p></section>
  <section><h3>What Gumbo sends to edit</h3><p>When you ask for an edit, Gumbo sends the AI what that request needs: your message, the project's timeline, and words and frames from your footage. It goes through Gumbo's service to the AI provider that runs the request (Anthropic, OpenAI, Google or DeepSeek) and is not used to train their models.</p></section>
  <section><h3>Your account</h3><p>Your email, your plan, and a record of each AI request (which model, how many tokens, what it cost) so your credits and usage add up. Not what you said or showed.</p></section>
  <section><h3>Your welcome answers</h3><p>What you told Gumbo when it first opened: your name, what you make, how much you've edited and how you found Gumbo. They're kept with your account so another computer doesn't ask again, and they tell us who Gumbo is for.</p></section>
  <section className="privacy-switch"><div><h3>Help improve Gumbo</h3><p>When an edit goes wrong (an error, a stop, or a long and costly run), send us that edit's log so we can fix it: the steps it took, your request and the code it wrote. Never your footage. You can always send a log yourself from any edit.</p></div><Switch label="Help improve Gumbo" checked={!!improve} disabled={improve===undefined} onChange={change}/></section>
  <section><h3>Payments</h3><p>Stripe handles every payment. Your card goes to Stripe, never to Gumbo.</p></section>
  <section><h3>Crash reports</h3><p>If Gumbo crashes, the report is saved on this computer and not sent anywhere.</p></section>
  <p className="settings-note">Questions, or want your account deleted? Email privacy@usegumbo.app.</p>
 </div>;
}

function About(p:{runtime:RuntimeStatus|null}){
 return <>
  <Row label="Version"><span className="settings-value">{p.runtime?.version??'…'}</span></Row>
  <Row label="Updates" help="Automatic updates are coming. For now, install new versions as they are released."><button type="button" className="settings-button-secondary" disabled>Check for updates</button></Row>
  <Row label="This computer"><span className="settings-value">{p.runtime?`${p.runtime.platform==='win32'?'Windows':p.runtime.platform==='darwin'?'macOS':p.runtime.platform}, ${p.runtime.memoryGb} GB memory`:'…'}</span></Row>
 </>;
}

export function SettingsPage(p:{onClose:()=>void;initial?:SettingsSection}){
 const [section,setSection]=useState<SettingsSection>(p.initial??'profile'),[settings,setSettings]=useState<AppSettings|null>(null),[runtime,setRuntime]=useState<RuntimeStatus|null>(null),[error,setError]=useState<string|null>(null),choice=useTheme(),panel=useRef<HTMLDivElement>(null);
 useEffect(()=>{void window.dream.settings().then(setSettings,(e:Error)=>setError(e.message));void window.dream.runtime().then(setRuntime,()=>{});},[]);
 // Esc closes Settings before anything under it hears it (the chat box's menus catch Esc early and stopped it reaching
 // Settings); an open dropdown in Settings keeps its own Esc.
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key!=='Escape'||e.target instanceof Element&&e.target.closest('select'))return;e.preventDefault();e.stopPropagation();p.onClose();};window.addEventListener('keydown',key,true);return()=>window.removeEventListener('keydown',key,true);},[p.onClose]);
 useEffect(()=>{panel.current?.scrollTo({top:0});},[section]);
 const save=async(patch:Partial<AppSettings>)=>{try{setSettings(await window.dream.saveSettings(patch));if(patch.profile)profileChanged();if(patch.disabledProviders)await refreshProviders();}catch(e){setError((e as Error).message);}};
 const title=sections.find(([id])=>id===section)![1];
 return <div className="settings-page" role="dialog" aria-modal="true" aria-label="Settings">
  <nav className="settings-nav" aria-label="Settings sections">
   <h2>Settings</h2>
   {sections.map(([id,label,Icon])=><button key={id} type="button" className={section===id?'selected':''} aria-current={section===id?'page':undefined} onClick={()=>setSection(id)}><Icon size={15}/>{label}</button>)}
  </nav>
  <div className="settings-panel" ref={panel}>
   <header className="settings-panel-head"><h1>{title}</h1><button type="button" className="settings-close" aria-label="Close settings" title="Close (Esc)" onClick={p.onClose}><X size={18}/></button></header>
   {error&&<p className="settings-error" role="alert">{error}</p>}
   <div className={'settings-body'+(section==='plan'?' wide':'')}>
    {section==='profile'&&(settings?<Profile settings={settings} save={save}/>:<Row label="Loading…"/>)}
    {section==='appearance'&&<Row label="Theme" help="System follows your computer's light or dark mode."><div className="settings-segments" role="radiogroup" aria-label="Theme">{themes.map(([id,label,Icon])=><button key={id} type="button" role="radio" aria-checked={choice===id} className={choice===id?'selected':''} onClick={()=>setThemeChoice(id)}><Icon size={14}/>{label}</button>)}</div></Row>}
    {section==='account'&&<Account/>}
    {section==='plan'&&<PlanPage/>}
    {section==='usage'&&<UsagePage onPlans={()=>setSection('plan')}/>}
    {section==='export'&&<Export/>}
    {section==='privacy'&&<Privacy/>}
    {section==='shortcuts'&&<dl className="settings-shortcuts">{shortcuts.map(([keys,what])=><React.Fragment key={keys}><dt>{what}</dt><dd><kbd>{keys}</kbd></dd></React.Fragment>)}</dl>}
    {section==='about'&&<About runtime={runtime}/>}
   </div>
  </div>
 </div>;
}
