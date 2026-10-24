import React,{useState,useRef,useLayoutEffect,useEffect} from 'react';
import {onWeb,webFolders,computerGrant,folderLabel,canPickFolders} from '../../platform';
import {useDraft,setDraft} from '../../store/draft';
import {MediaTile} from '../media/MediaTile';
import {ArrowUp,Plus,X,Upload,FolderOpen,Computer,Square,ListChecks,PencilLine,MessageCircle,ChevronDown,Check,Sparkles,Zap,Crown,Wand2,Cpu} from 'lucide-react';
import type {Permission,ModelChoice} from '../../store/editor';
import {shortcutHints} from '../../shortcuts';
import {modelInfo,typicalCost,type ModelInfo} from '@dream/config';
import {LabLogo} from './ModelLogos';
import {GumboMark} from '../home/HomeScreen';
import {useProviders,available,shortLabel,pickable,ROUX} from '../../models';
import {useCreatorMentions,type MentionPicks} from './CreatorMentions';
import {stopGuard} from './stop-guard';
import {FeedbackLink} from './FeedbackLink';
export type Attachment={id:string;name:string;asset?:import('@dream/footage').Asset};
type Props={value?:string;onChange?:(value:string)=>void;onSubmit:()=>void;onUpload:()=>void;onMedia?:()=>void;attachments:Attachment[];onRemove:(id:string)=>void;busy?:boolean;active?:boolean;onStop?:()=>void;home?:boolean;permission?:Permission;onPermission?:(value:Permission)=>void;model?:ModelChoice;onModel?:(value:ModelChoice)=>void;context?:React.ReactNode;picks?:MentionPicks};

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
 const menu=usePopover(),current=permissions.find(p=>p.id===value)??permissions[0],[computer,setComputer]=useState<{id:string}|null|undefined>(),[folders,setFolders]=useState<{id:string;path?:string}[]>([]);
 const refresh=async()=>{const grants=await window.dream.fileGrants();setComputer(computerGrant(grants)??null);setFolders(webFolders(grants));};
 useEffect(()=>{if(!menu.open)return;refresh().catch(()=>setComputer(undefined));},[menu.open]);
 // On the web, turning it off stops using every folder chosen for it (platform.ts webFolders).
 const toggleComputer=async()=>{try{if(computer){const grants=await window.dream.fileGrants();for(const g of onWeb()?webFolders(grants):[computer])await window.dream.revokeFileGrant(g.id);}else await window.dream.grantComputer();await refresh();}catch{}};
 // On the web each folder is chosen in the browser's picker: more can be added, and each removed.
 const addFolder=async()=>{try{await window.dream.grantComputer();await refresh();}catch{}},removeFolder=async(id:string)=>{try{await window.dream.revokeFileGrant(id);await refresh();}catch{}};
 return <div className="composer-popover-anchor" ref={menu.ref}>
  <button type="button" className={'composer-chip permission-chip '+value} aria-label={'Permissions: '+current.label} aria-haspopup="menu" aria-expanded={menu.open} onClick={()=>menu.setOpen(!menu.open)}>{current.icon}<span>{current.short}</span><ChevronDown size={12}/></button>
  {menu.open&&<div className="composer-popover permission-menu" role="menu" aria-label="Permissions">
   <header>Permissions<kbd>{shortcutHints.mode} · Ctrl+1/2/3</kbd></header>
   {permissions.map(p=><button key={p.id} type="button" role="menuitemradio" aria-checked={p.id===value} className={p.id===value?'selected':''} onClick={()=>{onChange(p.id);menu.setOpen(false);}}><span className="permission-icon">{p.icon}</span><span><strong>{p.label}</strong><small>{p.detail}</small></span>{p.id===value&&<Check size={14} className="permission-check"/>}</button>)}
   {computer!==undefined&&canPickFolders()&&<div className="permission-computer"><Computer size={14}/><span><strong>{onWeb()?'Search your folders':'Search this computer'}</strong><small>{onWeb()?(computer?'Gumbo can find and read files in these folders.':'Choose folders Gumbo can search, like Videos or Desktop.'):computer?'Gumbo can find and read your files.':'Gumbo only uses files you add.'}</small></span><button type="button" className={'switch'+(computer?' on':'')} role="switch" aria-checked={!!computer} aria-label={onWeb()?'Allow searching your folders':'Allow searching this computer'} onClick={()=>void toggleComputer()}><i/></button></div>}
   {onWeb()&&computer&&<div className="web-folders in-menu">{folders.map(f=><span key={f.id} className="web-folder"><FolderOpen size={13}/>{folderLabel(f.path!)}<button type="button" aria-label={`Stop using ${folderLabel(f.path!)}`} onClick={()=>void removeFolder(f.id)}><X size={12}/></button></span>)}<button type="button" className="web-folder add" onClick={()=>void addFolder()}><Plus size={13}/>Add a folder</button></div>}
  </div>}
 </div>;
}

/** The model picker, laid out like Rork's: Roux 1 (Gumbo's own model, the recommended default) on top, then every other
 * model with its lab's mark and its price as $ to $$$$$ (a typical request's credits on hover). Roux 1 is $; every
 * other model costs more. A provider without its key on the gateway is listed but greyed out. */
const premium:ModelChoice[]=['opus','sonnet','gpt-astra','gpt-sol','gemini-argon','gemini-flash'];
export function ModelMenu({value,onChange}:{value:ModelChoice;onChange:(value:ModelChoice)=>void}){
 const menu=usePopover(),providers=useProviders(),label=shortLabel(value),roux=modelInfo('deepseek-flash');
 const credits=(m:ModelInfo|undefined)=>m?Math.max(1,Math.round(typicalCost(m)*100)):3,signs=(cost:string)=>cost.length<2?'$$':cost;
 const pick=(choice:ModelChoice)=>{onChange(choice);menu.setOpen(false);};
 const models=premium.map(choice=>pickable.find(m=>m.choice===choice)).filter((m):m is ModelInfo=>!!m);
 return <div className="composer-popover-anchor" ref={menu.ref}>
  <button type="button" className={'composer-chip model-chip '+value} aria-label={'Model: '+label} aria-haspopup="menu" aria-expanded={menu.open} title="Model" onClick={()=>menu.setOpen(!menu.open)}><span>{label}</span><ChevronDown size={12}/></button>
  {menu.open&&<div className="composer-popover model-picker" role="menu" aria-label="Model">
   <button type="button" role="menuitemradio" aria-checked={value==='auto'} className={'model-roux'+(value==='auto'?' selected':'')} onClick={()=>pick('auto')}>
    <span className="model-logo roux"><GumboMark/></span>
    <span className="model-roux-text"><b>{ROUX}</b><small>Gumbo’s own model · Recommended</small></span>
    <span className="model-price" title={`About ${credits(roux)} credits for a typical request`}>$</span>
    <span className="model-check">{value==='auto'&&<Check size={15}/>}</span>
   </button>
   <div className="model-divider" role="separator"/>
   {models.map(m=>{const ready=available(m.choice,providers),selected=m.choice===value;
    return <button key={m.choice} type="button" role="menuitemradio" aria-checked={selected} disabled={!ready} title={ready?m.detail:'Not set up yet'} className={'model-row'+(selected?' selected':'')} onClick={()=>pick(m.choice)}>
     <span className="model-logo"><LabLogo provider={m.provider}/></span>
     <span className="model-name">{m.label.replace(/^Claude /,'')}</span>
     <span className="model-price" title={`About ${credits(m)} credits for a typical request`}>{signs(m.cost)}</span>
     <span className="model-check">{selected&&<Check size={15}/>}</span>
    </button>;})}
  </div>}
 </div>;
}


/** The value and onChange are the caller's when given; otherwise the box keeps the workspace draft (store/draft.ts). */
export function ChatComposer(props:Props){const draft=useDraft(s=>props.value===undefined?s.text:''),p={...props,value:props.value??draft,onChange:props.onChange??setDraft};const [menu,setMenu]=useState(false),textarea=useRef<HTMLTextAreaElement>(null),mentions=useCreatorMentions(textarea,p.value,p.onChange,p.picks);
 // Send becomes Stop in the same place: a click in the very first moment after sending is the same click repeated, not a
 // decision to stop (stop-guard.ts). Any later click stops at once (it waited 1.5 s, so a quick Stop did nothing). The
 // moment is taken before the frame that shows Stop: a passive effect could run after a queued second click.
 const guard=useRef(stopGuard()).current;useLayoutEffect(()=>{if(p.active)guard.shown();},[p.active]);const stop=()=>{if(guard.allows())p.onStop?.();};
 const resize=()=>{const node=textarea.current;if(!node)return;node.style.height='auto';node.style.height=Math.min(p.home?280:200,Math.max(p.home?76:44,node.scrollHeight))+'px';};
 useLayoutEffect(resize,[p.value,p.home,p.attachments.length]);
 useLayoutEffect(()=>{const node=textarea.current;if(!node)return;let width=node.offsetWidth;const observer=new ResizeObserver(()=>{if(node.offsetWidth!==width){width=node.offsetWidth;resize();}});observer.observe(node);return()=>observer.disconnect();},[]);
 const placeholder=p.home?'Describe the video you want to create…':p.permission==='ask'?'Ask anything about your video…':p.permission==='plan'?'Describe the change; Gumbo plans it first…':'Ask Gumbo to edit…';
 return <div className={'composer-area '+(p.home?'home-composer':'')}><form className="composer" onSubmit={e=>{e.preventDefault();p.onSubmit();}}>{mentions.menu}{p.context}{p.attachments.length>0&&<div className="attachment-list">{p.attachments.map(a=><MediaTile key={a.id} asset={a.asset} label={a.name} onRemove={()=>p.onRemove(a.id)}/>)}</div>}<textarea ref={textarea} aria-label="Ask Gumbo to edit" title={`${shortcutHints.chat} to type here`} placeholder={placeholder} value={p.value} onChange={e=>p.onChange(e.target.value)} onSelect={mentions.update} onKeyDown={e=>{if(mentions.onKeyDown(e))return;if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();if(!p.busy&&!p.active)p.onSubmit();}}}/><div className="composer-actions"><div className="attachment-menu-anchor"><button type="button" className="add-media" aria-label="Add media" aria-expanded={p.onMedia?menu:undefined} onClick={()=>{if(p.onMedia)setMenu(!menu);else p.onUpload();}}><span><Plus size={p.home?21:15}/></span>{p.home&&'Add media'}</button>{menu&&<div className="attachment-menu"><button type="button" onClick={()=>{setMenu(false);p.onUpload();}}><Upload size={16}/> Upload media</button>{p.onMedia&&<button type="button" onClick={()=>{setMenu(false);p.onMedia!();}}><FolderOpen size={16}/> Project media</button>}</div>}</div>{p.onPermission&&<PermissionMenu value={p.permission??'auto'} onChange={p.onPermission}/>}{p.onModel&&<ModelMenu value={p.model??'sonnet'} onChange={p.onModel}/>}<span className="spacer"/>{p.active?<button type="button" className="send" aria-label="Stop editing" onClick={stop}><Square size={p.home?12:9} fill="currentColor"/></button>:<button type="submit" className="send" aria-label="Send prompt" disabled={!p.value.trim()||p.busy}><ArrowUp size={p.home?18:15}/></button>}</div></form><FeedbackLink/></div>;}
