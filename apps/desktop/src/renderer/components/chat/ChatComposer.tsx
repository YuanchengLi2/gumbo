import React,{useState,useRef,useLayoutEffect,useEffect} from 'react';
import {MediaTile} from '../media/MediaTile';
import {ArrowUp,Plus,X,Upload,FolderOpen,Computer,Square,ListChecks,PencilLine,MessageCircle,ChevronDown,Check,Sparkles,Zap,Crown} from 'lucide-react';
import type {Permission,ModelChoice} from '../../store/editor';
export type Attachment={id:string;name:string;asset?:import('@dream/footage').Asset};
type Props={value:string;onChange:(value:string)=>void;onSubmit:()=>void;onUpload:()=>void;onMedia?:()=>void;attachments:Attachment[];onRemove:(id:string)=>void;busy?:boolean;active?:boolean;onStop?:()=>void;home?:boolean;permission?:Permission;onPermission?:(value:Permission)=>void;model?:ModelChoice;onModel?:(value:ModelChoice)=>void;context?:React.ReactNode};

export const permissions:{id:Permission;label:string;short:string;detail:string;icon:React.ReactNode}[]=[
 {id:'auto',label:'Edit automatically',short:'Edit',detail:'Figjam changes the project as it works. Changes to files on your computer still ask first.',icon:<PencilLine size={14}/>},
 {id:'plan',label:'Plan first',short:'Plan',detail:'Figjam writes a plan. Nothing changes until you approve it.',icon:<ListChecks size={14}/>},
 {id:'ask',label:'Ask only',short:'Ask',detail:'Answers, scripts and ideas. The project is never changed.',icon:<MessageCircle size={14}/>}
];
export const modelChoices:{id:ModelChoice;label:string;detail:string;icon:React.ReactNode}[]=[
 {id:'opus',label:'Opus',detail:'Most capable, for demanding creative work. About twice the cost of Sonnet.',icon:<Crown size={14}/>},
 {id:'sonnet',label:'Sonnet',detail:'The default. First cuts, long edits, motion graphics and everything in between.',icon:<Sparkles size={14}/>},
 {id:'haiku',label:'Haiku',detail:'Cheapest and fastest, for small, precise changes to an edit.',icon:<Zap size={14}/>}
];

/** Closes on outside click and Escape. */
function usePopover(){
 const [open,setOpen]=useState(false),ref=useRef<HTMLDivElement>(null);
 useEffect(()=>{if(!open)return;const close=(e:MouseEvent)=>{if(!ref.current?.contains(e.target as Node))setOpen(false);},key=(e:KeyboardEvent)=>{if(e.key==='Escape'){setOpen(false);e.stopPropagation();}};document.addEventListener('mousedown',close);document.addEventListener('keydown',key,true);return()=>{document.removeEventListener('mousedown',close);document.removeEventListener('keydown',key,true);};},[open]);
 return{open,setOpen,ref};
}


function PermissionMenu({value,onChange}:{value:Permission;onChange:(value:Permission)=>void}){
 const menu=usePopover(),current=permissions.find(p=>p.id===value)??permissions[0],[computer,setComputer]=useState<{id:string}|null|undefined>();
 useEffect(()=>{if(!menu.open)return;window.dream.fileGrants().then((grants:any[])=>setComputer(grants.find(g=>g.scope==='computer')??null)).catch(()=>setComputer(undefined));},[menu.open]);
 const toggleComputer=async()=>{try{if(computer)await window.dream.revokeFileGrant(computer.id);else await window.dream.grantComputer();const grants=await window.dream.fileGrants();setComputer(grants.find((g:any)=>g.scope==='computer')??null);}catch{}};
 return <div className="composer-popover-anchor" ref={menu.ref}>
  <button type="button" className={'composer-chip permission-chip '+value} aria-label={'Permissions: '+current.label} aria-haspopup="menu" aria-expanded={menu.open} onClick={()=>menu.setOpen(!menu.open)}>{current.icon}<span>{current.short}</span><ChevronDown size={12}/></button>
  {menu.open&&<div className="composer-popover permission-menu" role="menu" aria-label="Permissions">
   <header>Permissions</header>
   {permissions.map(p=><button key={p.id} type="button" role="menuitemradio" aria-checked={p.id===value} className={p.id===value?'selected':''} onClick={()=>{onChange(p.id);menu.setOpen(false);}}><span className="permission-icon">{p.icon}</span><span><strong>{p.label}</strong><small>{p.detail}</small></span>{p.id===value&&<Check size={14} className="permission-check"/>}</button>)}
   {computer!==undefined&&<div className="permission-computer"><Computer size={14}/><span><strong>Search this computer</strong><small>{computer?'Figjam can find and read your files.':'Figjam only uses files you add.'}</small></span><button type="button" className={'switch'+(computer?' on':'')} role="switch" aria-checked={!!computer} aria-label="Allow searching this computer" onClick={()=>void toggleComputer()}><i/></button></div>}
  </div>}
 </div>;
}

function ModelMenu({value,onChange}:{value:ModelChoice;onChange:(value:ModelChoice)=>void}){
 const menu=usePopover(),current=modelChoices.find(m=>m.id===value)??modelChoices[0];
 return <div className="composer-popover-anchor" ref={menu.ref}>
  <button type="button" className={'composer-chip model-chip '+value} aria-label={'Model: '+current.label} aria-haspopup="menu" aria-expanded={menu.open} title="Model" onClick={()=>menu.setOpen(!menu.open)}><span>{current.label}</span><ChevronDown size={12}/></button>
  {menu.open&&<div className="composer-popover permission-menu" role="menu" aria-label="Model">
   <header>Model</header>
   {modelChoices.map(m=><button key={m.id} type="button" role="menuitemradio" aria-checked={m.id===value} className={m.id===value?'selected':''} onClick={()=>{onChange(m.id);menu.setOpen(false);}}><span className="permission-icon">{m.icon}</span><span><strong>{m.label}</strong><small>{m.detail}</small></span>{m.id===value&&<Check size={14} className="permission-check"/>}</button>)}
  </div>}
 </div>;
}


export function ChatComposer(p:Props){const [menu,setMenu]=useState(false),textarea=useRef<HTMLTextAreaElement>(null);
 const resize=()=>{const node=textarea.current;if(!node)return;node.style.height='auto';node.style.height=Math.min(p.home?280:200,Math.max(p.home?76:44,node.scrollHeight))+'px';};
 useLayoutEffect(resize,[p.value,p.home,p.attachments.length]);
 useLayoutEffect(()=>{const node=textarea.current;if(!node)return;let width=node.offsetWidth;const observer=new ResizeObserver(()=>{if(node.offsetWidth!==width){width=node.offsetWidth;resize();}});observer.observe(node);return()=>observer.disconnect();},[]);
 const placeholder=p.home?'Describe the video you want to create…':p.permission==='ask'?'Ask anything about your video…':p.permission==='plan'?'Describe the change; Figjam plans it first…':'Ask Figjam to edit…';
 return <div className={'composer-area '+(p.home?'home-composer':'')}><form className="composer" onSubmit={e=>{e.preventDefault();p.onSubmit();}}>{p.context}{p.attachments.length>0&&<div className="attachment-list">{p.attachments.map(a=><MediaTile key={a.id} asset={a.asset} label={a.name} onRemove={()=>p.onRemove(a.id)}/>)}</div>}<textarea ref={textarea} aria-label="Ask Figjam to edit" placeholder={placeholder} value={p.value} onChange={e=>p.onChange(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();if(!p.busy&&!p.active)p.onSubmit();}}}/><div className="composer-actions"><div className="attachment-menu-anchor"><button type="button" className="add-media" aria-label="Add media" aria-expanded={p.onMedia?menu:undefined} onClick={()=>{if(p.onMedia)setMenu(!menu);else p.onUpload();}}><span><Plus size={p.home?21:15}/></span>{p.home&&'Add media'}</button>{menu&&<div className="attachment-menu"><button type="button" onClick={()=>{setMenu(false);p.onUpload();}}><Upload size={16}/> Upload media</button>{p.onMedia&&<button type="button" onClick={()=>{setMenu(false);p.onMedia!();}}><FolderOpen size={16}/> Project media</button>}</div>}</div>{p.onPermission&&<PermissionMenu value={p.permission??'auto'} onChange={p.onPermission}/>}{p.onModel&&<ModelMenu value={p.model??'sonnet'} onChange={p.onModel}/>}<span className="spacer"/>{p.active?<button type="button" className="send" aria-label="Stop editing" onClick={p.onStop}><Square size={p.home?12:9} fill="currentColor"/></button>:<button type="submit" className="send" aria-label="Send prompt" disabled={!p.value.trim()||p.busy}><ArrowUp size={p.home?18:15}/></button>}</div></form></div>;}
