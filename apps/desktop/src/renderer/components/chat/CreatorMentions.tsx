import React,{useEffect,useMemo,useRef,useState} from 'react';
import {Film,Music2,Sparkles,FolderOpen,Type,Layers} from 'lucide-react';
import {matchCreators,MEDIA} from '@dream/config';
import {resolve} from '@dream/timeline';
import type {ProjectSummary} from '@dream/contracts';
import {useEditor} from '../../store/editor';

/** The composer's @ menu. Typing @ offers four kinds of reference, so the agent knows exactly what is meant:
 *  - what is on the timeline (clips, text, scenes, music), by place and time: picked, it joins the selected items above
 *    the box and the preview goes to it, as clicking it on the timeline does ("make @ shorter" with Clip 3 picked);
 *  - this project's media: picked, it is attached as the + button attaches it (on the home screen, with no project, it is
 *    written in as @[beach.mp4]);
 *  - the user's other projects, as @[Vietnam trip] ("make the colors like @[Vietnam trip]"): the agent can read that edit;
 *  - creators, as @MrBeast ("make the intro like @MrBeast"): Gumbo's style library answers at once, and YouTube's
 *    channels join once the typing pauses (a search costs 1% of the daily YouTube quota, so it waits for 400 ms of quiet
 *    and two letters).
 * Arrow keys move, Enter or Tab picks, Esc closes. */
type Kind='timeline'|'media'|'project'|'creator';
type Item={kind:Kind;key:string;insert:string;title:string;detail:string;image?:string;icon?:React.ComponentType<{size?:number}>;badge?:string;id?:string};
/** What a pick does instead of writing a reference into the message, where the box has somewhere to put it. */
export type MentionPicks={onAsset?:(assetId:string)=>void;onItem?:(itemId:string)=>void};
const token=(text:string,caret:number)=>/(^|\s)@([A-Za-z0-9_.-]{0,30})$/.exec(text.slice(0,caret));
const subscribers=(n?:number)=>!n?'':n>=1e6?`${(n/1e6).toFixed(n>=1e7?0:1)}M subscribers`:n>=1e3?`${Math.round(n/1e3)}K subscribers`:`${n} subscribers`;
const clock=(sec?:number)=>sec?`${Math.floor(sec/60)}:${String(Math.round(sec%60)).padStart(2,'0')}`:'';
const ago=(iso:string)=>{const days=Math.floor((Date.now()-Date.parse(iso))/864e5);return days<1?'today':days<2?'yesterday':days<7?`${days} days ago`:days<30?`${Math.floor(days/7)} weeks ago`:new Date(iso).toLocaleDateString();};
const matches=(q:string,...texts:(string|undefined)[])=>!q||texts.some(t=>t?.toLowerCase().replace(/\s+/g,'').includes(q.toLowerCase()));
// A name inside @[...] cannot hold a closing bracket.
const bracket=(name:string)=>`@[${name.replace(/\]/g,')').slice(0,120)}]`;
const titles:Record<Kind,string>={timeline:'On the timeline',media:'Media in this project',project:'Your projects',creator:'Edit in the style of'};
const span=(start:number,end:number)=>`${clock(start)||'0:00'}–${clock(end)||'0:00'}`;

let projectsCache:{at:number;list:ProjectSummary[]}|undefined;
const loadProjects=async()=>{if(projectsCache&&Date.now()-projectsCache.at<60_000)return projectsCache.list;const list=await window.dream.projects().catch(()=>[] as ProjectSummary[]);projectsCache={at:Date.now(),list};return list;};

export function useCreatorMentions(textarea:React.RefObject<HTMLTextAreaElement|null>,value:string,onChange:(value:string)=>void,picks:MentionPicks={}){
 const [query,setQuery]=useState<string|null>(null),[found,setFound]=useState<Item[]>([]),[limited,setLimited]=useState(false),[projects,setProjects]=useState<ProjectSummary[]>([]),[active,setActive]=useState(0),closed=useRef<string|null>(null);
 const assets=useEditor(s=>s.project?.footage.assets),current=useEditor(s=>s.project?.meta.id),timeline=useEditor(s=>s.project?.timeline),footage=useEditor(s=>s.project?.footage);
 const q=query??'';
 // The timeline's pieces in time order, worked out only while the menu is open.
 const pieces=useMemo<Item[]>(()=>{if(query===null||!picks.onItem||!timeline||!footage)return[];let r;try{r=resolve(timeline,footage);}catch{return[];}
  const names=new Map(footage.assets.map(a=>[a.id,a] as const)),list:(Item&{at:number})[]=[];
  r.clips.forEach((c,n)=>{const a=names.get(c.assetId);list.push({kind:'timeline',key:'t:'+c.id,id:c.id,insert:'',at:c.start,title:`Clip ${n+1}`,detail:[a?.filename,span(c.start,c.end)].filter(Boolean).join(' · '),
   ...(a&&(a.kind==='image'||a.thumbnailPath)?{image:`${MEDIA}${a.id}/${a.thumbnailPath?'thumbnail':'original'}`}:{icon:Film})});});
  for(const i of r.items){const text=typeof i.params?.text==='string'?i.params.text:undefined,a=i.source?names.get(i.source.assetId):undefined;
   list.push({kind:'timeline',key:'t:'+i.id,id:i.id,insert:'',at:i.timelineStart,title:text?`“${text.slice(0,40)}”`:a?(a.scene?a.filename.replace(/\.[^.]+$/,''):a.filename):String(i.component??i.type),
    detail:[text?'Text':a?.scene?'Scene':a?(a.kind==='image'?'Picture':'Overlay'):'Effect',span(i.timelineStart,i.timelineEnd)].join(' · '),icon:text?Type:a?.scene?Sparkles:Layers});}
  for(const m of r.music){const a=names.get(m.assetId);list.push({kind:'timeline',key:'t:'+m.id,id:m.id,insert:'',at:m.timelineStart,title:a?.filename??'Music',detail:['Sound',span(m.timelineStart,m.timelineEnd)].join(' · '),icon:Music2});}
  return list.sort((a,b)=>a.at-b.at);},[query===null,timeline,footage,!!picks.onItem]);
 const onTimeline:Item[]=pieces.filter(p=>matches(q,p.title,p.detail)).slice(0,q?6:5);
 const media:Item[]=query===null?[]:(assets??[]).filter(a=>a.generated?.role!=='stem'&&matches(q,a.filename)).slice(0,4).map(a=>({kind:'media',key:'m:'+a.id,id:a.id,insert:bracket(a.filename),title:a.filename,
  detail:[a.scene?'Scene':a.kind==='audio'?'Audio':a.kind==='image'?'Image':'Video',clock(a.durationSec)].filter(Boolean).join(' · '),
  ...(a.kind==='image'||a.thumbnailPath?{image:`${MEDIA}${a.id}/${a.thumbnailPath?'thumbnail':'original'}`}:{icon:a.scene?Sparkles:a.kind==='audio'?Music2:Film})}));
 const yours:Item[]=query===null?[]:projects.filter(p=>p.id!==current&&!p.missing&&!(p as any).archived&&matches(q,p.name)).slice(0,4).map(p=>({kind:'project',key:'p:'+p.id,insert:bracket(p.name),title:p.name,
  detail:[`Edited ${ago(p.updatedAt)}`,clock(p.durationSec)].filter(Boolean).join(' · '),...(p.thumbnail?{image:p.thumbnail}:{icon:FolderOpen})}));
 const library:Item[]=query===null?[]:matchCreators(q,4).map(c=>({kind:'creator',key:'c:'+c.handle.toLowerCase(),insert:'@'+c.handle,title:c.name,detail:c.look,badge:'Style guide'}));
 const creators=[...library,...found.filter(f=>!library.some(l=>l.key===f.key))].slice(0,6);
 const items=[...onTimeline,...media,...yours,...creators];
 // Which @ the caret is in, read after every change and caret move.
 const update=()=>{const node=textarea.current;if(!node)return;const m=token(node.value,node.selectionStart??0);const next=m?m[2]:null;if(next!==closed.current)closed.current=null;setQuery(next!==null&&closed.current===null?next:null);};
 useEffect(update,[value]);
 const open=query!==null;
 useEffect(()=>{if(open)void loadProjects().then(setProjects);},[open]);
 useEffect(()=>{setActive(0);setFound([]);setLimited(false);if(query===null||query.length<2)return;let live=true;
  const timer=setTimeout(()=>{void window.dream.command({type:'account',action:'creators',query}).then((r:any)=>{if(live)setLimited(!!r?.limited);if(live)setFound((r?.creators??[]).filter((c:any)=>c?.handle).map((c:any)=>({kind:'creator',key:'c:'+String(c.handle).toLowerCase(),insert:'@'+c.handle,title:String(c.title),detail:[`@${c.handle}`,subscribers(c.subscribers)].filter(Boolean).join(' · '),...(c.avatar?{image:c.avatar}:{})})));},()=>{});},400);
  return()=>{live=false;clearTimeout(timer);};},[query]);
 const pick=(item:Item)=>{const node=textarea.current;if(!node)return;const caret=node.selectionStart??node.value.length,m=token(node.value,caret);if(!m)return;
  // A timeline piece or this project's media goes where the box shows it (the selected items, the attachments), and the
  // @ typed for it is taken out; the rest is written in as a reference.
  const placed=item.kind==='timeline'&&item.id&&picks.onItem?(picks.onItem(item.id),true):item.kind==='media'&&item.id&&picks.onAsset?(picks.onAsset(item.id),true):false;
  const start=caret-m[2].length-1,insert=placed?'':item.insert+' ',next=node.value.slice(0,start)+insert+node.value.slice(caret);onChange(next);setQuery(null);
  requestAnimationFrame(()=>{node.focus();const at=start+insert.length;node.setSelectionRange(at,at);});};
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
  {limited&&<p className="creator-limited">This month's YouTube searches are used up. Gumbo's style guides still work; a bigger plan searches more.</p>}
 </div>:null;
 return{menu,onKeyDown,update};
}
