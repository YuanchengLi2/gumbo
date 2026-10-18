import React,{useState,useRef,useLayoutEffect,useEffect} from 'react';
import {MediaTile} from '../media/MediaTile';
import {ArrowUp,Plus,X,Upload,FolderOpen,Computer,Square,ListChecks,PencilLine,MessageCircle,ChevronDown,Check,Sparkles,Zap,Crown,Wand2,Cpu} from 'lucide-react';
import type {Permission,ModelChoice} from '../../store/editor';
import {shortcutHints} from '../../shortcuts';
import {modelCatalog,providerLabels} from '@dream/config';
import {useProviders,available,shortLabel} from '../../models';
export type Attachment={id:string;name:string;asset?:import('@dream/footage').Asset};
type Props={value:string;onChange:(value:string)=>void;onSubmit:()=>void;onUpload:()=>void;onMedia?:()=>void;attachments:Attachment[];onRemove:(id:string)=>void;busy?:boolean;active?:boolean;onStop?:()=>void;home?:boolean;permission?:Permission;onPermission?:(value:Permission)=>void;model?:ModelChoice;onModel?:(value:ModelChoice)=>void;context?:React.ReactNode};

export const permissions:{id:Permission;label:string;short:string;detail:string;icon:React.ReactNode}[]=[
 {id:'auto',label:'Edit automatically',short:'Edit',detail:'Gumbo changes the project as it works. Changes to files on your computer still ask first.',icon:<PencilLine size={14}/>},
 {id:'plan',label:'Plan first',short:'Plan',detail:'Gumbo writes a plan. Nothing changes until you approve it.',icon:<ListChecks size={14}/>},
 {id:'ask',label:'Ask only',short:'Ask',detail:'Answers, scripts and ideas. The project is never changed.',icon:<MessageCircle size={14}/>}
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
   <header>Permissions<kbd>{shortcutHints.mode} · Ctrl+1/2/3</kbd></header>
   {permissions.map(p=><button key={p.id} type="button" role="menuitemradio" aria-checked={p.id===value} className={p.id===value?'selected':''} onClick={()=>{onChange(p.id);menu.setOpen(false);}}><span className="permission-icon">{p.icon}</span><span><strong>{p.label}</strong><small>{p.detail}</small></span>{p.id===value&&<Check size={14} className="permission-check"/>}</button>)}
   {computer!==undefined&&<div className="permission-computer"><Computer size={14}/><span><strong>Search this computer</strong><small>{computer?'Gumbo can find and read your files.':'Gumbo only uses files you add.'}</small></span><button type="button" className={'switch'+(computer?' on':'')} role="switch" aria-checked={!!computer} aria-label="Allow searching this computer" onClick={()=>void toggleComputer()}><i/></button></div>}
  </div>}
 </div>;
}

/** The model picker: Auto first, as the one to leave on, then each provider's models as rows with what they're for (Most
 * capable, Balanced, Fast) and their cost as a five-step meter. A provider without its key on the gateway is listed but
 * greyed out. */
const tierTag:Record<string,[string,typeof Zap]>={frontier:['Most capable',Crown],strong:['Balanced',Cpu],light:['Fast',Zap]};
const providerDot:Record<string,string>={anthropic:'#d97757',openai:'#10a37f',google:'#4285f4',deepseek:'#536af5'};
export function ModelMenu({value,onChange}:{value:ModelChoice;onChange:(value:ModelChoice)=>void}){
 const menu=usePopover(),providers=useProviders(),label=shortLabel(value);
 const groups=(['anthropic','openai','google','deepseek'] as const).map(provider=>({provider,models:modelCatalog.filter(m=>m.provider===provider)}));
 const pick=(choice:ModelChoice)=>{onChange(choice);menu.setOpen(false);};
 return <div className="composer-popover-anchor" ref={menu.ref}>
  <button type="button" className={'composer-chip model-chip '+value} aria-label={'Model: '+label} aria-haspopup="menu" aria-expanded={menu.open} title="Model" onClick={()=>menu.setOpen(!menu.open)}>{value==='auto'&&<Sparkles size={13}/>}<span>{label}</span><ChevronDown size={12}/></button>
  {menu.open&&<div className="composer-popover model-picker" role="menu" aria-label="Model">
   <header><span>Model</span><kbd>{shortcutHints.model}</kbd></header>
   <button type="button" role="menuitemradio" aria-checked={value==='auto'} className={'model-auto'+(value==='auto'?' selected':'')} onClick={()=>pick('auto')}>
    <span className="model-auto-icon"><Wand2 size={16}/></span><span className="model-auto-text"><b>Auto<em>Recommended</em></b><small>Picks the right model for each request</small></span>{value==='auto'&&<Check size={15}/>}
   </button>
   {groups.map(g=>{const ready=available(g.models[0].choice,providers);return <section key={g.provider} className={'model-provider'+(ready?'':' off')}>
    <h4><i style={{background:providerDot[g.provider]}}/>{providerLabels[g.provider]}{!ready&&<small>Not set up</small>}</h4>
    {g.models.map(m=>{const [tag,Icon]=tierTag[m.tier]??tierTag.strong,dots=Math.min(5,m.cost.length);
     return <button key={m.choice} type="button" role="menuitemradio" aria-checked={m.choice===value} disabled={!available(m.choice,providers)} className={'model-row'+(m.choice===value?' selected':'')} title={m.detail} onClick={()=>pick(m.choice)}>
      <span className="model-name">{m.label.replace(/^Claude /,'')}</span>
      <span className={'model-tag '+m.tier}><Icon size={11}/>{tag}</span>
      <span className="model-cost" aria-label={`Cost ${dots} of 5`}>{[1,2,3,4,5].map(n=><i key={n} className={n<=dots?'on':''}/>)}</span>
      <span className="model-check">{m.choice===value&&<Check size={14}/>}</span>
     </button>;})}
   </section>;})}
  </div>}
 </div>;
}


export function ChatComposer(p:Props){const [menu,setMenu]=useState(false),textarea=useRef<HTMLTextAreaElement>(null);
 // Send becomes Stop in the same place: a click in the very first moment after sending is the same click repeated, not a
 // decision to stop. Any later click stops at once (it waited 1.5 s, so a quick Stop did nothing).
 const stopShown=useRef(0);useEffect(()=>{if(p.active)stopShown.current=Date.now();},[p.active]);const stop=()=>{if(Date.now()-stopShown.current>=350)p.onStop?.();};
 const resize=()=>{const node=textarea.current;if(!node)return;node.style.height='auto';node.style.height=Math.min(p.home?280:200,Math.max(p.home?76:44,node.scrollHeight))+'px';};
 useLayoutEffect(resize,[p.value,p.home,p.attachments.length]);
 useLayoutEffect(()=>{const node=textarea.current;if(!node)return;let width=node.offsetWidth;const observer=new ResizeObserver(()=>{if(node.offsetWidth!==width){width=node.offsetWidth;resize();}});observer.observe(node);return()=>observer.disconnect();},[]);
 const placeholder=p.home?'Describe the video you want to create…':p.permission==='ask'?'Ask anything about your video…':p.permission==='plan'?'Describe the change; Gumbo plans it first…':'Ask Gumbo to edit…';
 return <div className={'composer-area '+(p.home?'home-composer':'')}><form className="composer" onSubmit={e=>{e.preventDefault();p.onSubmit();}}>{p.context}{p.attachments.length>0&&<div className="attachment-list">{p.attachments.map(a=><MediaTile key={a.id} asset={a.asset} label={a.name} onRemove={()=>p.onRemove(a.id)}/>)}</div>}<textarea ref={textarea} aria-label="Ask Gumbo to edit" title={`${shortcutHints.chat} to type here`} placeholder={placeholder} value={p.value} onChange={e=>p.onChange(e.target.value)} onKeyDown={e=>{if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();if(!p.busy&&!p.active)p.onSubmit();}}}/><div className="composer-actions"><div className="attachment-menu-anchor"><button type="button" className="add-media" aria-label="Add media" aria-expanded={p.onMedia?menu:undefined} onClick={()=>{if(p.onMedia)setMenu(!menu);else p.onUpload();}}><span><Plus size={p.home?21:15}/></span>{p.home&&'Add media'}</button>{menu&&<div className="attachment-menu"><button type="button" onClick={()=>{setMenu(false);p.onUpload();}}><Upload size={16}/> Upload media</button>{p.onMedia&&<button type="button" onClick={()=>{setMenu(false);p.onMedia!();}}><FolderOpen size={16}/> Project media</button>}</div>}</div>{p.onPermission&&<PermissionMenu value={p.permission??'auto'} onChange={p.onPermission}/>}{p.onModel&&<ModelMenu value={p.model??'sonnet'} onChange={p.onModel}/>}<span className="spacer"/>{p.active?<button type="button" className="send" aria-label="Stop editing" onClick={stop}><Square size={p.home?12:9} fill="currentColor"/></button>:<button type="submit" className="send" aria-label="Send prompt" disabled={!p.value.trim()||p.busy}><ArrowUp size={p.home?18:15}/></button>}</div></form></div>;}
