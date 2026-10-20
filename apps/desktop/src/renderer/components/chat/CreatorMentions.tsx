import React,{useEffect,useRef,useState} from 'react';
import {Film,Music2,Sparkles,FolderOpen} from 'lucide-react';
import {matchCreators} from '@dream/config';
import type {ProjectSummary} from '@dream/contracts';
import {useEditor} from '../../store/editor';

/** The composer's @ menu. Typing @ offers three kinds of reference, each written into the message so the agent knows
 * exactly what is meant (the project service resolves them, see apps/project-service/src/mentions.ts):
 *  - this project's media, as @[beach.mp4] ("use @[beach.mp4] for the intro");
 *  - the user's other projects, as @[Vietnam trip] ("make the colors like @[Vietnam trip]"): the agent can read that edit;
 *  - creators, as @MrBeast ("make the intro like @MrBeast"): Gumbo's style library answers at once, and YouTube's
 *    channels join once the typing pauses (a search costs 1% of the daily YouTube quota, so it waits for 400 ms of quiet
 *    and two letters).
 * Arrow keys move, Enter or Tab picks, Esc closes. */
type Kind='media'|'project'|'creator';
type Item={kind:Kind;key:string;insert:string;title:string;detail:string;image?:string;icon?:React.ComponentType<{size?:number}>;badge?:string};
const token=(text:string,caret:number)=>/(^|\s)@([A-Za-z0-9_.-]{0,30})$/.exec(text.slice(0,caret));
const subscribers=(n?:number)=>!n?'':n>=1e6?`${(n/1e6).toFixed(n>=1e7?0:1)}M subscribers`:n>=1e3?`${Math.round(n/1e3)}K subscribers`:`${n} subscribers`;
const clock=(sec?:number)=>sec?`${Math.floor(sec/60)}:${String(Math.round(sec%60)).padStart(2,'0')}`:'';
const ago=(iso:string)=>{const days=Math.floor((Date.now()-Date.parse(iso))/864e5);return days<1?'today':days<2?'yesterday':days<7?`${days} days ago`:days<30?`${Math.floor(days/7)} weeks ago`:new Date(iso).toLocaleDateString();};
const matches=(q:string,...texts:(string|undefined)[])=>!q||texts.some(t=>t?.toLowerCase().replace(/\s+/g,'').includes(q.toLowerCase()));
// A name inside @[...] cannot hold a closing bracket.
const bracket=(name:string)=>`@[${name.replace(/\]/g,')').slice(0,120)}]`;
const titles:Record<Kind,string>={media:'Media in this project',project:'Your projects',creator:'Edit in the style of'};

let projectsCache:{at:number;list:ProjectSummary[]}|undefined;
const loadProjects=async()=>{if(projectsCache&&Date.now()-projectsCache.at<60_000)return projectsCache.list;const list=await window.dream.projects().catch(()=>[] as ProjectSummary[]);projectsCache={at:Date.now(),list};return list;};

export function useCreatorMentions(textarea:React.RefObject<HTMLTextAreaElement|null>,value:string,onChange:(value:string)=>void){
 const [query,setQuery]=useState<string|null>(null),[found,setFound]=useState<Item[]>([]),[projects,setProjects]=useState<ProjectSummary[]>([]),[active,setActive]=useState(0),closed=useRef<string|null>(null);
 const assets=useEditor(s=>s.project?.footage.assets),current=useEditor(s=>s.project?.meta.id);
 const q=query??'';
 const media:Item[]=query===null?[]:(assets??[]).filter(a=>a.generated?.role!=='stem'&&matches(q,a.filename)).slice(0,4).map(a=>({kind:'media',key:'m:'+a.id,insert:bracket(a.filename),title:a.filename,
  detail:[a.scene?'Scene':a.kind==='audio'?'Audio':a.kind==='image'?'Image':'Video',clock(a.durationSec)].filter(Boolean).join(' · '),
  ...(a.kind==='image'||a.thumbnailPath?{image:`dream-media://${a.id}/${a.thumbnailPath?'thumbnail':'original'}`}:{icon:a.scene?Sparkles:a.kind==='audio'?Music2:Film})}));
 const yours:Item[]=query===null?[]:projects.filter(p=>p.id!==current&&!p.missing&&!(p as any).archived&&matches(q,p.name)).slice(0,4).map(p=>({kind:'project',key:'p:'+p.id,insert:bracket(p.name),title:p.name,
  detail:[`Edited ${ago(p.updatedAt)}`,clock(p.durationSec)].filter(Boolean).join(' · '),...(p.thumbnail?{image:p.thumbnail}:{icon:FolderOpen})}));
 const library:Item[]=query===null?[]:matchCreators(q,4).map(c=>({kind:'creator',key:'c:'+c.handle.toLowerCase(),insert:'@'+c.handle,title:c.name,detail:c.look,badge:'Style guide'}));
 const creators=[...library,...found.filter(f=>!library.some(l=>l.key===f.key))].slice(0,6);
 const items=[...media,...yours,...creators];
 // Which @ the caret is in, read after every change and caret move.
 const update=()=>{const node=textarea.current;if(!node)return;const m=token(node.value,node.selectionStart??0);const next=m?m[2]:null;if(next!==closed.current)closed.current=null;setQuery(next!==null&&closed.current===null?next:null);};
 useEffect(update,[value]);
 const open=query!==null;
 useEffect(()=>{if(open)void loadProjects().then(setProjects);},[open]);
 useEffect(()=>{setActive(0);setFound([]);if(query===null||query.length<2)return;let live=true;
  const timer=setTimeout(()=>{void window.dream.command({type:'account',action:'creators',query}).then((r:any)=>{if(live)setFound((r?.creators??[]).filter((c:any)=>c?.handle).map((c:any)=>({kind:'creator',key:'c:'+String(c.handle).toLowerCase(),insert:'@'+c.handle,title:String(c.title),detail:[`@${c.handle}`,subscribers(c.subscribers)].filter(Boolean).join(' · '),...(c.avatar?{image:c.avatar}:{})})));},()=>{});},400);
  return()=>{live=false;clearTimeout(timer);};},[query]);
 const pick=(item:Item)=>{const node=textarea.current;if(!node)return;const caret=node.selectionStart??node.value.length,m=token(node.value,caret);if(!m)return;
  const start=caret-m[2].length-1,next=node.value.slice(0,start)+item.insert+' '+node.value.slice(caret);onChange(next);setQuery(null);
  requestAnimationFrame(()=>{node.focus();const at=start+item.insert.length+1;node.setSelectionRange(at,at);});};
 /** Arrow keys, Enter, Tab and Esc while the menu is open; true when the key was the menu's. */
 const onKeyDown=(e:React.KeyboardEvent)=>{if(query===null||!items.length)return false;
  if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();setActive(a=>(a+(e.key==='ArrowDown'?1:items.length-1))%items.length);return true;}
  if(e.key==='Enter'||e.key==='Tab'){e.preventDefault();pick(items[Math.min(active,items.length-1)]);return true;}
  if(e.key==='Escape'){e.preventDefault();e.stopPropagation();closed.current=query;setQuery(null);return true;}
  return false;};
 const menu=query!==null&&items.length>0?<div className="composer-popover creator-menu" role="listbox" aria-label="Mention">
  {items.map((item,n)=><React.Fragment key={item.key}>
   {(n===0||items[n-1].kind!==item.kind)&&<header>{titles[item.kind]}</header>}
   <button type="button" role="option" aria-selected={n===active} className={n===active?'active':''} onMouseDown={e=>e.preventDefault()} onMouseEnter={()=>setActive(n)} onClick={()=>pick(item)}>
    {item.image?<img src={item.image} alt="" className={'creator-avatar'+(item.kind==='creator'?'':' square')}/>:<span className={'creator-avatar'+(item.kind==='creator'?'':' square')}>{item.icon?<item.icon size={15}/>:item.title[0]}</span>}
    <span className="creator-text"><b>{item.title}</b><span>{item.detail}</span></span>
    {item.badge&&<span className="creator-badge" title="Gumbo knows this creator's style in detail">{item.badge}</span>}
   </button>
  </React.Fragment>)}
 </div>:null;
 return{menu,onKeyDown,update};
}
