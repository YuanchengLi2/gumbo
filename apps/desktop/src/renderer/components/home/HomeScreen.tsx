import React from 'react';
import {Film,FolderOpen,Smartphone,Scissors,Plane,Captions,ArrowUpRight,Plus,Loader2,Pin,ChevronRight} from 'lucide-react';
import {ProjectMenu,type MenuAt} from './ProjectMenu';
import {useWorking} from '../../working';
import {onWeb} from '../../platform';
import type {ProjectSummary,ProjectAction} from '@dream/contracts';
import {ChatComposer,type Attachment} from '../chat/ChatComposer';
import {useEditor} from '../../store/editor';
import {ProfileMenu} from '../settings/SettingsMenu';
import {SidebarUpgrade} from '../billing/Upgrade';
import {useBilling,billingReady} from '../../billing';
import {useCreatorName} from '../../profile';
import {useAccount} from '../../account';

/** The Gumbo mark, as on usegumbo.app: a paprika bowl with a play button in it and steam rising. The steam takes the text
 * colour, so the mark reads on light and dark; the bowl is the app's one brand colour. */
export function GumboMark(){return <svg className="gumbo-mark" viewBox="0 0 64 64" aria-hidden="true"><path d="M10 30h44c0 13-9.8 23-22 23S10 43 10 30z" fill="var(--paprika)"/><path d="M28 35.5l9.5 5.5-9.5 5.5z" fill="#FFF8EE"/><g fill="none" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round"><path d="M24 23c-2.6-3 2.6-5.2 0-8.6"/><path d="M32 23c-2.6-3 2.6-5.2 0-8.6"/><path d="M40 23c-2.6-3 2.6-5.2 0-8.6"/></g></svg>;}
const time=(seconds:number)=>`${Math.floor(seconds/60)}:${Math.floor(seconds%60).toString().padStart(2,'0')}`;
const updated=(project:ProjectSummary)=>{
 if(project.missing)return 'Folder unavailable';if(project.updatedAt.startsWith('1970'))return 'Saved on this computer';
 const days=Math.floor((Date.now()-Date.parse(project.updatedAt))/864e5);
 return days<1?'Edited today':days<2?'Edited yesterday':days<7?`Edited ${days} days ago`:'Edited '+new Date(project.updatedAt).toLocaleDateString(undefined,{month:'short',day:'numeric'});
};
// One click fills the box with a request worth starting from; the user adds their clips and sends.
const ideas:[typeof Film,string,string][]=[
 [Smartphone,'YouTube Short','Turn my clips into a punchy 30-second YouTube Short in 9:16, with captions and music.'],
 [Scissors,'Cut the silences','Remove the long silences and tighten the pacing, keeping every word.'],
 [Plane,'Travel recap','Make a cinematic travel recap of my best moments, with titles and music.'],
 [Captions,'Add captions','Add bold, readable captions that follow the speech.']
];

/** Home, laid out like Claude's: a sidebar with the mark, a new video, opening a project and the recent ones, and you at its
 * foot (the profile menu, which holds Settings); beside it one big box to start an edit, quick ideas, and the projects as
 * pictures. The top strip of both is the window's drag area, and the window's own controls sit on the main side. */
export function HomeScreen(p:{projects:ProjectSummary[];value:string;onChange:(v:string)=>void;attachments:Attachment[];onRemove:(id:string)=>void;onSubmit:()=>void;onUpload:()=>void;onOpen:(folder?:string)=>void;onProjectAction:(project:ProjectSummary,action:ProjectAction)=>Promise<void>;busy:boolean}){
 const name=useCreatorName().split(/\s+/)[0],permission=useEditor(s=>s.permission),model=useEditor(s=>s.model),working=useWorking(),billing=useBilling(),plan=billingReady(billing)&&billing.plan!=='free'?billing.planName:'';
 const waitlisted=!!useAccount()?.waitlisted;
 // The sidebar's width is the user's: dragged at its edge, kept on this computer.
 const [side,setSide]=React.useState(()=>{try{return Math.min(420,Math.max(200,Number(localStorage.getItem('gumbo-sidebar-width'))||240));}catch{return 240;}});
 const resize=(e:React.PointerEvent)=>{e.preventDefault();const startX=e.clientX,start=side;let last=start;
  const move=(m:PointerEvent)=>{last=Math.min(420,Math.max(200,start+m.clientX-startX));setSide(last);};
  const up=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);document.body.classList.remove('resizing-side');try{localStorage.setItem('gumbo-sidebar-width',String(last));}catch{}};
  document.body.classList.add('resizing-side');window.addEventListener('pointermove',move);window.addEventListener('pointerup',up);};
 // Right-click a project for its menu; pinned ones lead the sidebar, archived ones wait under Archived.
 const [menu,setMenu]=React.useState<MenuAt|null>(null),[showArchived,setShowArchived]=React.useState(false);
 const options=(project:ProjectSummary)=>(e:React.MouseEvent)=>{e.preventDefault();setMenu({project,x:e.clientX,y:e.clientY});};
 // Projects with an edit running come first in the recents (then the most recent), so everything in progress is in view.
 const live=p.projects.filter(x=>!x.archived),pinned=live.filter(x=>x.pinned),recent=live.filter(x=>!x.pinned).sort((a,b)=>Number(working.has(b.id))-Number(working.has(a.id))),archived=p.projects.filter(x=>x.archived);
 const item=(project:ProjectSummary)=><button type="button" key={project.id} className={(project.missing?'missing ':'')+(menu?.project.id===project.id?'menu-open':'')} title={project.name} onClick={()=>p.onOpen(project.folder)} onContextMenu={options(project)}><span>{project.name}</span>{working.has(project.id)&&<i className="spin"><Loader2 size={13} aria-label="Gumbo is editing"/></i>}</button>;
 // A new video starts in the box: it is cleared and focused.
 const newVideo=()=>{p.onChange('');requestAnimationFrame(()=>document.querySelector<HTMLTextAreaElement>('.fig-home .home-composer textarea')?.focus());};
 return <div className="home-screen fig-home" style={{'--side-width':`${side}px`} as React.CSSProperties}>
  <aside className="home-side" aria-label="Gumbo">
   <div className="home-brand"><GumboMark/><span>Gumbo</span>{plan&&<span className="home-brand-plan">{plan}</span>}</div>
   <nav className="home-nav">
    <button type="button" className="home-new" onClick={newVideo}><Plus size={16}/>New video</button>
    {/* On the web projects live in the browser: they open from the list, not from a folder. */}
    {!onWeb()&&<button type="button" onClick={()=>p.onOpen()}><FolderOpen size={16}/>Open project</button>}
   </nav>
   <div className="home-lists">
    {pinned.length>0&&<section className="home-recents" aria-label="Pinned projects"><h2><Pin size={11}/>Pinned</h2>{pinned.map(item)}</section>}
    {recent.length>0&&<section className="home-recents" aria-label="Recent projects"><h2>Recent</h2>{recent.slice(0,30).map(item)}</section>}
    {archived.length>0&&<section className="home-recents archived" aria-label="Archived projects"><button type="button" className="home-archived-toggle" aria-expanded={showArchived} onClick={()=>setShowArchived(v=>!v)}><ChevronRight size={12}/>Archived<small>{archived.length}</small></button>{showArchived&&archived.map(item)}</section>}
   </div>
   <SidebarUpgrade/>
   <footer className="home-side-foot"><ProfileMenu up label/></footer>
   <div className="home-side-resize" role="separator" aria-orientation="vertical" aria-label="Resize the sidebar" onPointerDown={resize} onDoubleClick={()=>{setSide(240);try{localStorage.setItem('gumbo-sidebar-width','240');}catch{}}}/>
  </aside>
  <main className="fig-home-main">
   <div className="home-drag" aria-hidden="true"/>
   <section className="fig-hero">
    <h1>What are we cooking today{name?`, ${name}`:''}?</h1>
    {waitlisted&&<p className="home-waitlist" role="status">You're on the waitlist. We'll email you when your spot opens, and then you can start editing.</p>}
    <ChatComposer home value={p.value} onChange={p.onChange} onSubmit={p.onSubmit} attachments={p.attachments} onRemove={p.onRemove} onUpload={p.onUpload} busy={p.busy} permission={permission} onPermission={useEditor.getState().setPermission} model={model} onModel={useEditor.getState().setModel}/>
    <div className="fig-ideas">{ideas.map(([Icon,label,prompt])=><button key={label} onClick={()=>p.onChange(prompt)}><Icon size={14}/>{label}</button>)}</div>
   </section>
   <section className="fig-recent" aria-label="Your projects">
    <header><h2>Your projects</h2>{live.length>0&&<span>{live.length}</span>}</header>
    {live.length?<div className="fig-project-grid">{[...pinned,...recent].map(project=><button className={'project-card'+(project.missing?' missing':'')} key={project.id} onClick={()=>p.onOpen(project.folder)} onContextMenu={options(project)}>
     <div className="project-cover">{project.thumbnail?<img src={project.thumbnail} alt=""/>:<div className="project-cover-empty"><Film size={24}/></div>}{project.durationSec>0&&<span className="duration-badge">{time(project.durationSec)}</span>}{working.has(project.id)&&<span className="project-working"><i className="spin"><Loader2 size={12}/></i>Editing</span>}{project.pinned&&!working.has(project.id)&&<span className="project-pin" title="Pinned"><Pin size={11}/></span>}<i className="project-open"><ArrowUpRight size={15}/></i></div>
     <strong>{project.name}</strong><small>{updated(project)}</small>
    </button>)}</div>:<div className="fig-empty"><GumboMark/><div><strong>Your first edit starts above.</strong><p>Add your clips, say what you want, and Gumbo cuts it on a real timeline. Projects are saved here automatically.</p></div></div>}
   </section>
  </main>
  <ProjectMenu at={menu} onClose={()=>setMenu(null)} onOpen={project=>p.onOpen(project.folder)} onAction={p.onProjectAction}/>
 </div>;
}
