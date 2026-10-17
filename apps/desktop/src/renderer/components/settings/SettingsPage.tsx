import React,{useEffect,useRef,useState} from 'react';
import {X,User,Sun,Moon,Monitor,KeyRound,Gauge,Sparkles,FolderOpen,Clapperboard,ShieldCheck,Keyboard,Info} from 'lucide-react';
import type {AppSettings,FileGrant,RuntimeStatus,UsageSummary} from '@dream/contracts';
import {autoModels,modelInfo,providerLabels,type Provider} from '@dream/config';
import {useTheme,setThemeChoice,type ThemeChoice} from '../../theme';
import {shortcutHints} from '../../shortcuts';
import {useEditor} from '../../store/editor';
import {choices,shortLabel,available,useProviders,refreshProviders,modelName} from '../../models';
import {useAccount,requireSignIn,signedOut} from '../../account';
import {useBilling,billingReady,choosePlan,buyCredits,manageBilling,credits} from '../../billing';

/** Settings as a page of its own, laid out as Claude's: sections in a sidebar on the left, the chosen one on the right, as
 * plain rows (a label, what it does, its control). Most rows change what already exists (the theme, the composer's model,
 * mode and effort, file access, the export window's choices); Profile and Privacy are the app's settings (settings.json),
 * which every request's agent and the model list follow. Usage and billing shows the plan and credits; paying is on Stripe. */
export type SettingsSection='profile'|'appearance'|'account'|'usage'|'ai'|'files'|'export'|'privacy'|'shortcuts'|'about';
const sections:[SettingsSection,string,typeof User][]=[['profile','Profile',User],['appearance','Appearance',Sun],['account','Account',KeyRound],['usage','Usage and billing',Gauge],['ai','AI',Sparkles],['files','Files and access',FolderOpen],['export','Export',Clapperboard],['privacy','Privacy',ShieldCheck],['shortcuts','Shortcuts',Keyboard],['about','About',Info]];
const themes:[ThemeChoice,string,typeof Sun][]=[['light','Light',Sun],['dark','Dark',Moon],['system','System',Monitor]];
const shortcuts:[string,string][]=[[shortcutHints.chat+' or /','Type in the chat'],[shortcutHints.mode,'Edit, Plan or Ask'],['Ctrl+1 / 2 / 3','Edit / Plan / Ask'],[shortcutHints.model,'Next model'],['Space','Play or pause'],['Ctrl+B','Split at playhead'],['Ctrl+D','Duplicate'],['Delete','Delete selection'],['Ctrl+Z','Undo'],['Esc','Leave fullscreen or close Settings']];
const dollars=(n:number)=>`$${n%1?n.toFixed(2):n}`,day=(iso:string)=>new Date(iso).toLocaleDateString(undefined,{month:'short',day:'numeric'});

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

/** Usage and billing: the plan and the credits left, the plans to choose from and credits to buy (both on Stripe's pages,
 * in the browser), and what the credits went on: today, the last 30 days by day, and by model. */
function Usage(){
 const billing=useBilling(),[usage,setUsage]=useState<UsageSummary|{unavailable:true}|null|undefined>(undefined),[error,setError]=useState<string|null>(null),[opened,setOpened]=useState<string|null>(null);
 useEffect(()=>{window.dream.command<any>({type:'account',action:'usage'}).then(setUsage,(e:Error)=>setError(e.message));},[]);
 const pay=async(label:string,open:()=>Promise<unknown>)=>{setError(null);setOpened(label);try{await open();}catch(e){setOpened(null);setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/,''));}};
 const summary=usage&&!('unavailable' in usage)?usage:null,b=billingReady(billing)?billing:null,peak=Math.max(1,...(summary?.days??[]).map(d=>d.credits));
 if(billing===null||usage===null)return <><p className="settings-lead">Sign in to see your plan and credits.</p><button type="button" className="settings-button-primary" onClick={()=>void requireSignIn()}>Sign in</button></>;
 if(billing&&'unavailable' in billing)return <Row label="Billing is not available yet" help="Your Gumbo service needs its latest update to show plans and credits here."/>;
 return <>
  {error&&<p className="settings-error" role="alert">{error}</p>}
  {!b?<Row label="Loading your plan…"/>:<>
   <section className="billing-plan" aria-label="Your plan">
    <header><div><strong>{b.planName}</strong><span>{b.plan==='free'?'Free':`${dollars(b.plans.find(x=>x.id===b.plan)!.priceUsd)} a month`}{b.renewsAt&&` · ${b.cancelAtPeriodEnd?'ends':b.plan==='free'?'new credits':'renews'} ${day(b.renewsAt)}`}</span></div>
     {b.portal&&<button type="button" className="settings-button-secondary" onClick={()=>void pay('portal',manageBilling)}>Manage billing</button>}</header>
    <div className="billing-left"><strong>{credits(b.credits.left)}</strong><span>credits left</span></div>
    <div className="settings-meter" role="meter" aria-label="Plan credits left" aria-valuemin={0} aria-valuemax={b.credits.planTotal} aria-valuenow={Math.max(0,b.credits.plan)}><span style={{width:`${Math.round(Math.min(1,Math.max(0,b.credits.plan)/Math.max(1,b.credits.planTotal))*100)}%`}}/></div>
    <p>{credits(b.credits.plan)} of {credits(b.credits.planTotal)} from your plan{b.credits.topups>0&&<>, plus {credits(b.credits.topups)} bought, which don't expire</>}.{b.credits.overdraft>0&&<> {credits(b.credits.overdraft)} over, taken from your next credits.</>}</p>
    <footer><button type="button" className="settings-button-primary" disabled={!b.payments} onClick={()=>void pay('credits',()=>buyCredits(1))}>Buy {credits(b.topup.credits)} credits · {dollars(b.topup.priceUsd)}</button>{opened&&<span className="billing-opened">Opened in your browser. Your credits show here once you've paid.</span>}</footer>
   </section>
   <h3 className="settings-subhead">Plans</h3>
   <div className="billing-plans">{b.plans.map(plan=>{const current=plan.id===b.plan,order=['free','pro','max','max20'],up=order.indexOf(plan.id)>order.indexOf(b.plan);
    return <div key={plan.id} className={'billing-plan-card'+(current?' current':'')}>
     <strong>{plan.name}</strong><span className="billing-price">{plan.priceUsd?<>{dollars(plan.priceUsd)}<small> a month</small></>:'Free'}</span>
     <span className="billing-credits">{credits(plan.credits)} credits a month</span>
     {current?<span className="billing-current">Your plan</span>:plan.id==='free'?<span className="billing-current muted">{b.portal?'Cancel in Manage billing':''}</span>:
      <button type="button" className={up?'settings-button-primary':'settings-button-secondary'} disabled={!b.payments} onClick={()=>void pay(plan.id,()=>choosePlan(plan.id as 'pro'|'max'|'max20'))}>{b.plan==='free'?'Choose':up?'Upgrade':'Switch'}</button>}
    </div>;})}</div>
   {!b.payments&&<p className="settings-note">Paying isn't set up on your Gumbo service yet, so plans and credits can't be bought.</p>}
   <p className="settings-note">One credit is one cent of AI. A small change uses a few; a whole video usually 100 to 300.</p>
  </>}
  <h3 className="settings-subhead">Usage</h3>
  {usage===undefined?<Row label="Loading usage…"/>:'unavailable' in usage?<Row label="Usage is not available yet" help="Your Gumbo service needs its latest update to report usage here."/>:summary&&<>
   <Row label="Today"><span className="settings-value">{credits(summary.todayCredits)} credits</span></Row>
   <Row label="Last 30 days" help={`${summary.requests} AI calls`}><span className="settings-value">{credits(summary.monthCredits)} credits</span></Row>
   <div className="billing-days" role="img" aria-label="Credits used each day over the last 30 days">{summary.days.map(d=><i key={d.date} title={`${day(d.date+'T12:00:00Z')}: ${credits(d.credits)} credits`} style={{height:`${Math.max(d.credits>0?6:2,Math.round(d.credits/peak*100))}%`}}/>)}</div>
   {summary.byModel.length>0&&<div className="settings-table" role="table" aria-label="Last 30 days by model">{summary.byModel.map(m=><div role="row" key={m.model}><span role="cell">{modelName(m.model)}</span><span role="cell">{m.calls} calls</span><span role="cell">{credits(m.credits)}</span></div>)}</div>}
  </>}
 </>;
}

function AI(){
 const s=useEditor(),providers=useProviders();
 const autoNames=(['light','strong'] as const).map(tier=>autoModels[tier].map(choice=>modelInfo(choice)!).find(m=>available(m.choice,providers)));
 return <>
  <Row label="Model" help={<>The model new requests use. Auto picks for each request: {autoNames[0]?.label} for small changes, {autoNames[1]?.label} for everything else. Other models run only when you pick them.</>}>
   <select className="settings-select" aria-label="Model" value={s.model} onChange={e=>s.setModel(e.target.value as typeof s.model)}>{choices.map(choice=><option key={choice} value={choice} disabled={!available(choice,providers)}>{shortLabel(choice)}{available(choice,providers)?'':' (not available)'}</option>)}</select>
  </Row>
  <Row label="Mode" help="Edit makes changes; Plan proposes a plan to approve first; Ask only answers."><Segments label="Mode" value={s.permission} options={[['auto','Edit'],['plan','Plan'],['ask','Ask']] as const} onChange={s.setPermission}/></Row>
  <Row label="Effort" help="How hard the AI thinks. Auto matches it to the request; higher is slower and costs more."><Segments label="Effort" value={s.effort} options={[['auto','Auto'],['low','Low'],['medium','Medium'],['high','High']] as const} onChange={s.setEffort}/></Row>
  <p className="settings-note">These are also in the chat box; a change in either place changes both.</p>
 </>;
}

function Files(p:{runtime:RuntimeStatus|null;onError:(e:string)=>void}){
 const [grants,setGrants]=useState<FileGrant[]|null>(null);
 const load=()=>window.dream.fileGrants().then(setGrants,(e:Error)=>p.onError(e.message));useEffect(()=>{void load();},[]);
 const active=(grants??[]).filter(g=>!g.revokedAt),computer=active.find(g=>g.scope==='computer'),folders=active.filter(g=>g.scope!=='computer'&&g.scope!=='project');
 return <>
  <Row label="Computer access" help={computer?'Gumbo can search this computer for the files a request needs, and asks before changing or moving any of them.':'Let Gumbo find files on this computer itself, so you don\'t have to attach them.'}>
   {computer?<button type="button" className="settings-button-secondary" onClick={async()=>{try{await window.dream.revokeFileGrant(computer.id);await load();}catch(e){p.onError((e as Error).message);}}}>Turn off</button>
    :<button type="button" className="settings-button-primary" onClick={async()=>{try{await window.dream.grantComputer();await load();}catch(e){p.onError((e as Error).message);}}}>Allow</button>}
  </Row>
  {folders.length>0&&<><h3 className="settings-subhead">Folders you allowed</h3>{folders.map(g=><Row key={g.id} label={g.path??g.scope} help={g.write?'Read and write':'Read only'}><button type="button" className="settings-button-secondary" onClick={async()=>{try{await window.dream.revokeFileGrant(g.id);await load();}catch(e){p.onError((e as Error).message);}}}>Remove</button></Row>)}</>}
  <Row label="Projects folder" help={p.runtime?.projectsFolder??'Where your projects are saved.'}><button type="button" className="settings-button-secondary" onClick={()=>window.dream.openFolder('projects').catch((e:Error)=>p.onError(e.message))}>Open</button></Row>
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

const providerData:[Provider,string][]=[['anthropic','Claude routes every request and runs light and hard work, so it cannot be switched off.'],['openai','GPT-6.1 Sol does most real edits in Auto.'],['google','Gemini models, when you pick them.'],['deepseek','DeepSeek, when you pick it.']];
function Privacy(p:{settings:AppSettings;save:(patch:Partial<AppSettings>)=>void;onError:(e:string)=>void}){
 const providers=useProviders(),off=new Set<string>(p.settings.disabledProviders);
 return <>
  <p className="settings-lead">To edit, Gumbo sends the AI provider your messages, what is in the project and frames and words from your footage. Turn off the providers you don't want to receive them.</p>
  {providerData.map(([id,help])=>{const fixed=id==='anthropic',unset=!fixed&&!off.has(id)&&providers[id]===false;return <Row key={id} label={providerLabels[id]} help={unset?help+' Not set up on your Gumbo service yet.':help}>
   <Switch label={providerLabels[id]} checked={fixed||!off.has(id)} disabled={fixed} onChange={on=>{const next=new Set(off);if(on)next.delete(id);else next.add(id);p.save({disabledProviders:[...next] as AppSettings['disabledProviders']});}}/>
  </Row>;})}
  <h3 className="settings-subhead">On this computer</h3>
  <Row label="Projects and footage" help="Your projects and media stay on this computer; only what a request needs is sent."/>
  <Row label="Crash reports" help="When Gumbo crashes, the report is saved on this computer and not sent anywhere."><button type="button" className="settings-button-secondary" onClick={()=>window.dream.openFolder('logs').catch((e:Error)=>p.onError(e.message))}>Open logs</button></Row>
 </>;
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
 const save=async(patch:Partial<AppSettings>)=>{try{setSettings(await window.dream.saveSettings(patch));if(patch.disabledProviders)await refreshProviders();}catch(e){setError((e as Error).message);}};
 const title=sections.find(([id])=>id===section)![1];
 return <div className="settings-page" role="dialog" aria-modal="true" aria-label="Settings">
  <nav className="settings-nav" aria-label="Settings sections">
   <h2>Settings</h2>
   {sections.map(([id,label,Icon])=><button key={id} type="button" className={section===id?'selected':''} aria-current={section===id?'page':undefined} onClick={()=>setSection(id)}><Icon size={15}/>{label}</button>)}
  </nav>
  <div className="settings-panel" ref={panel}>
   <header className="settings-panel-head"><h1>{title}</h1><button type="button" className="settings-close" aria-label="Close settings" title="Close (Esc)" onClick={p.onClose}><X size={18}/></button></header>
   {error&&<p className="settings-error" role="alert">{error}</p>}
   <div className="settings-body">
    {section==='profile'&&(settings?<Profile settings={settings} save={save}/>:<Row label="Loading…"/>)}
    {section==='appearance'&&<Row label="Theme" help="System follows your computer's light or dark mode."><div className="settings-segments" role="radiogroup" aria-label="Theme">{themes.map(([id,label,Icon])=><button key={id} type="button" role="radio" aria-checked={choice===id} className={choice===id?'selected':''} onClick={()=>setThemeChoice(id)}><Icon size={14}/>{label}</button>)}</div></Row>}
    {section==='account'&&<Account/>}
    {section==='usage'&&<Usage/>}
    {section==='ai'&&<AI/>}
    {section==='files'&&<Files runtime={runtime} onError={setError}/>}
    {section==='export'&&<Export/>}
    {section==='privacy'&&(settings?<Privacy settings={settings} save={save} onError={setError}/>:<Row label="Loading…"/>)}
    {section==='shortcuts'&&<dl className="settings-shortcuts">{shortcuts.map(([keys,what])=><React.Fragment key={keys}><dt>{what}</dt><dd><kbd>{keys}</kbd></dd></React.Fragment>)}</dl>}
    {section==='about'&&<About runtime={runtime}/>}
   </div>
  </div>
 </div>;
}
