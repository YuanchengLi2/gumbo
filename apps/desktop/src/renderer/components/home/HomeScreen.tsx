import React from 'react';
import {Film,FolderOpen,Smartphone,Scissors,Plane,Captions,ArrowUpRight} from 'lucide-react';
import type {ProjectSummary} from '@dream/contracts';
import {ChatComposer,type Attachment} from '../chat/ChatComposer';
import {useEditor} from '../../store/editor';

/** The Figjam mark: a fig with a leaf, as on usefigjam.com. */
export function DreamMark(){return <svg className="dream-mark" viewBox="0 0 64 64" aria-hidden="true"><circle cx="32" cy="36" r="22" fill="#6b4fd8"/><circle cx="25" cy="31" r="3" fill="#fff" opacity=".9"/><path d="M32 14c2-6 8-9 13-8-1 6-6 10-13 8z" fill="#34b27d"/></svg>;}
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

export function HomeScreen(p:{projects:ProjectSummary[];value:string;onChange:(v:string)=>void;attachments:Attachment[];onRemove:(id:string)=>void;onSubmit:()=>void;onUpload:()=>void;onOpen:(folder?:string)=>void;busy:boolean}){
 const permission=useEditor(s=>s.permission),model=useEditor(s=>s.model);
 const hour=new Date().getHours(),greeting=hour<5?'Up late?':hour<12?'Good morning.':hour<18?'Good afternoon.':'Good evening.';
 return <div className="home-screen fig-home">
  <header className="fig-home-top"><div className="fig-brand"><DreamMark/><span>figjam</span></div><span className="spacer"/><button className="fig-ghost" onClick={()=>p.onOpen()}><FolderOpen size={15}/>Open project</button></header>
  <main className="fig-home-main">
   <section className="fig-hero">
    <p className="fig-greeting">{greeting}</p>
    <h1>What do you want to create?</h1>
    <ChatComposer home value={p.value} onChange={p.onChange} onSubmit={p.onSubmit} attachments={p.attachments} onRemove={p.onRemove} onUpload={p.onUpload} busy={p.busy} permission={permission} onPermission={useEditor.getState().setPermission} model={model} onModel={useEditor.getState().setModel}/>
    <div className="fig-ideas">{ideas.map(([Icon,label,prompt])=><button key={label} onClick={()=>p.onChange(prompt)}><Icon size={14}/>{label}</button>)}</div>
   </section>
   <section className="fig-recent" aria-label="Your projects">
    <header><h2>Recent projects</h2>{p.projects.length>0&&<span>{p.projects.length}</span>}</header>
    {p.projects.length?<div className="fig-project-grid">{p.projects.map(project=><button className={'project-card'+(project.missing?' missing':'')} key={project.id} onClick={()=>p.onOpen(project.folder)}>
     <div className="project-cover">{project.thumbnail?<img src={project.thumbnail} alt=""/>:<div className="project-cover-empty"><Film size={26}/></div>}{project.durationSec>0&&<span className="duration-badge">{time(project.durationSec)}</span>}<i className="project-open"><ArrowUpRight size={15}/></i></div>
     <strong>{project.name}</strong><small>{updated(project)}</small>
    </button>)}</div>:<div className="fig-empty"><DreamMark/><div><strong>Your first edit starts above.</strong><p>Add your clips, say what you want, and Figjam cuts it on a real timeline. Projects are saved here automatically.</p></div></div>}
   </section>
  </main>
 </div>;
}
