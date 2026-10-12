import {editingActivity,editingChanges} from '../../editing-language';
import React,{useEffect,useRef,useState} from 'react';
import {LoaderCircle,AlertCircle,ChevronRight,Music2,Film,FileText,Search,Globe,PencilLine,Clapperboard,Eye,ScanEye,ListChecks,Type,Bookmark,Users,Wand2,Dot} from 'lucide-react';
import type {PublicActivity} from '@dream/contracts';
import type {Asset} from '@dream/footage';
import {MessageText} from './MessageText';
import {ScenePeek} from './ScenePeek';

// Notes read as prose; consecutive actions fold into one row; each worker task is a row holding its own notes and actions.
type Item={kind:'prose';event:PublicActivity}|{kind:'actions';events:PublicActivity[]}|{kind:'task';event:PublicActivity};
// A tool call is live from its first streamed argument until its result: drafting, ready (waiting to run) and running.
const live=(status:string)=>['running','drafting','ready','streaming'].includes(status);
const hidden=(event:PublicActivity)=>event.kind==='reasoning'||event.kind==='terminal'||event.tool==='finish';
const isTask=(event:PublicActivity)=>event.tool==='delegate'&&event.id.startsWith('worker:');
const Assets=React.createContext<Asset[]>([]);

// As in Cursor, each step shows what kind of thing it did; a live step's words shimmer, a failed one turns red.
const tools:Record<string,typeof FileText>={read_file:FileText,list_files:FileText,read_transcript:FileText,search:Search,web_search:Globe,fetch_url:Globe,write_file:PencilLine,edit_file:PencilLine,propose_file_changes:PencilLine,run_command:Wand2,bundle_scene:Wand2,publish_project:Clapperboard,view_media:Eye,check_outputs:ScanEye,update_tasks:ListChecks,set_project_title:Type,remember_decision:Bookmark,delegate:Users};
function StepIcon({event,running}:{event:PublicActivity;running:boolean}){
 if(running&&live(event.status))return <LoaderCircle size={13} className="spin"/>;
 if(['failed','interrupted'].includes(event.status))return <AlertCircle size={13}/>;
 const Icon=event.tool?tools[event.tool]:undefined;return Icon?<Icon size={13}/>:<Dot size={13}/>;
}

function items(events:PublicActivity[],all:PublicActivity[]):Item[]{
 const out:Item[]=[];
 for(const event of events){
  if(hidden(event))continue;
  // A delegation is shown through its task rows once its workers start.
  if(event.tool==='delegate'&&event.id.startsWith('tool:')&&all.some(e=>e.id.startsWith('worker:'+event.id.slice(5)+':')))continue;
  if(event.kind==='commentary'){if(event.text.trim())out.push({kind:'prose',event});continue;}
  if(isTask(event)){out.push({kind:'task',event});continue;}
  const last=out.at(-1);if(last?.kind==='actions')last.events.push(event);else out.push({kind:'actions',events:[event]});
 }
 return out;
}

/** Media a step looked at or produced: footage thumbnails, and published scenes drawn live from their code. */
function MediaStrip({media}:{media:NonNullable<PublicActivity['media']>}){
 const assets=React.useContext(Assets),seen=new Set<string>(),shown=media.flatMap(m=>{const asset=assets.find(a=>a.id===m.id);if(!asset||seen.has(asset.id))return[];seen.add(asset.id);return[asset];}).slice(0,4);
 if(!shown.length)return null;
 return <div className={'stream-media'+(shown.length===1?' single':'')}>{shown.map(asset=><figure key={asset.id} className="stream-thumb" title={asset.filename}>
  {asset.scene?<ScenePeek asset={asset}/>:asset.thumbnailPath||asset.kind==='image'?<img src={'dream-media://'+asset.id+'/'+(asset.thumbnailPath?'thumbnail':'original')} alt="" loading="lazy" onError={e=>{e.currentTarget.style.visibility='hidden';}}/>:<span className="stream-thumb-icon">{asset.kind==='audio'?<Music2 size={18}/>:<Film size={18}/>}</span>}
  <figcaption>{asset.scene?'Live scene':asset.kind==='audio'?'Audio':asset.kind==='image'?'Image':'Footage'} · {asset.filename}</figcaption>
 </figure>)}</div>;
}

/** Scenes a worker is still writing, drawn live from their draft code before anything is published. */
function DraftStrip({drafts}:{drafts:NonNullable<PublicActivity['drafts']>}){
 return <div className={'stream-media'+(drafts.length===1?' single':'')}>{drafts.slice(0,3).map(draft=>{const asset={id:'draft_'+draft.hash,filename:draft.name,kind:'video',durationSec:draft.durationInFrames/draft.fps,fps:draft.fps,width:draft.width,height:draft.height,originalPath:'',fingerprint:draft.hash,scene:{format:'engine',revisionId:draft.hash.padEnd(64,'0'),durationInFrames:draft.durationInFrames}} as unknown as Asset;
  return <figure key={draft.hash} className="stream-thumb" title={draft.name}><ScenePeek asset={asset} src={`dream-engine://app/draft/${draft.hash}/index.html`}/><figcaption>Draft · {draft.name}</figcaption></figure>;})}</div>;
}
function Action({event,running}:{event:PublicActivity;running:boolean}){
 const changes=editingChanges(event.changes??[]),text=editingActivity(event),icon=<StepIcon event={event} running={running}/>,shimmer=running&&live(event.status);
 return <div className={'run-event '+event.status} data-event-id={event.id}>{changes.length?<details className="run-event-details"><summary>{icon}<span className={shimmer?'shimmer':''}>{text}</span><ChevronRight className="run-disclosure" size={12}/></summary><ul>{changes.map((change,n)=><li key={n}>{change}</li>)}</ul></details>:<div className="stream-action">{icon}<span className={shimmer?'shimmer':''}>{text}</span></div>}{!!event.media?.length&&<MediaStrip media={event.media}/>}{!!event.drafts?.length&&<DraftStrip drafts={event.drafts}/>}</div>;
}

function Actions({events,running}:{events:PublicActivity[];running:boolean}){
 if(events.length===1)return <Action event={events[0]} running={running}/>;
 const current=running?events.findLast(e=>live(e.status)):undefined,shown=current??events.at(-1)!,status=current?current.status:events.some(e=>e.status==='failed')?'failed':events.every(e=>e.status==='complete')?'complete':shown.status,media=events.flatMap(e=>e.media??[]);
 // Folded steps keep their pictures visible; the list itself opens on demand.
 return <div className="run-group-block"><details className={'run-group '+status}><summary><StepIcon event={{...shown,status}} running={running}/><span className={current?'shimmer':''}>{editingActivity(shown)}</span><small>{events.length} steps</small><ChevronRight className="run-disclosure" size={12}/></summary><div className="run-group-items">{events.map(event=><Action key={event.id} event={{...event,media:undefined}} running={running}/>)}</div></details>{!!media.length&&<MediaStrip media={media}/>}</div>;
}

function Task({event,all,running}:{event:PublicActivity;all:PublicActivity[];running:boolean}){
 const children=all.filter(e=>e.parent===event.id),shown=children.filter(e=>!hidden(e)),thinking=children.findLast(e=>e.kind==='reasoning'&&live(e.status)),latest=shown.at(-1),working=running&&live(event.status);
 return <details className={'run-task '+event.status} data-event-id={event.id}><summary><StepIcon event={event} running={running}/><span className="run-task-title">{editingActivity(event)}{working&&(thinking||latest)&&<small className="run-task-live shimmer">{thinking?thinking.text:latest!.kind==='commentary'?latest!.text.trim().split('\n')[0]:editingActivity(latest!)}</small>}</span>{!!shown.length&&<ChevronRight className="run-disclosure" size={12}/>}</summary>{!!shown.length&&<div className="run-task-body"><Items list={items(children,all)} all={all} running={running}/></div>}</details>;
}

function Items({list,all,running}:{list:Item[];all:PublicActivity[];running:boolean}){
 return <>{list.map(item=>item.kind==='prose'?<div key={item.event.id} className="run-progress" data-event-id={item.event.id}><MessageText text={item.event.text} streaming={running&&item.event.status==='streaming'}/></div>:item.kind==='task'?<Task key={item.event.id} event={item.event} all={all} running={running}/>:<Actions key={item.events[0].id} events={item.events} running={running}/>)}</>;
}

export const clock=(ms:number)=>{const s=Math.max(0,Math.floor(ms/1000));return s<60?s+'s':Math.floor(s/60)+'m '+String(s%60).padStart(2,'0')+'s';};
/** Seconds since the request started, ticking while it runs. */
export function useElapsed(running:boolean,startedAt?:string){
 const mounted=useRef(Date.now()),[now,setNow]=useState(Date.now());
 useEffect(()=>{if(!running)return;setNow(Date.now());const timer=setInterval(()=>setNow(Date.now()),1000);return()=>clearInterval(timer);},[running]);
 const start=startedAt?Date.parse(startedAt):NaN;return clock(now-(Number.isFinite(start)?Math.min(start,now):mounted.current));
}

export function RunStream({events,running,assets=[],startedAt}:{events:PublicActivity[];running:boolean;assets?:Asset[];startedAt?:string}){
 const all=events.slice().sort((a,b)=>a.sequence-b.sequence),ids=new Set(all.map(e=>e.id)),top=all.filter(e=>!e.parent||!ids.has(e.parent)),list=items(top,all);
 // While the run is between steps (the model is thinking), a shimmering line shows it is still working.
 const busy=running&&all.some(e=>!hidden(e)&&live(e.status)&&(!e.parent||all.some(p=>p.id===e.parent&&live(p.status)))),elapsed=useElapsed(running,startedAt??all[0]?.startedAt);
 return <div className="run-stream" aria-label="Figjam activity"><Assets.Provider value={assets}><Items list={list} all={all} running={running}/></Assets.Provider>
  {running&&!busy&&<div className="run-working" role="status"><span className="shimmer">{list.length?'Thinking':'Planning next moves'}</span><small>{elapsed}</small></div>}
 </div>;
}
