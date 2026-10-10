import {editingActivity,editingChanges} from '../../editing-language';
import React from 'react';
import {Check,LoaderCircle,AlertCircle,ChevronRight} from 'lucide-react';
import type {PublicActivity} from '@dream/contracts';

// Notes read as prose; consecutive actions fold into one row; each worker task is a row holding its own notes and actions.
type Item={kind:'prose';event:PublicActivity}|{kind:'actions';events:PublicActivity[]}|{kind:'task';event:PublicActivity};
const live=(status:string)=>['running','drafting'].includes(status);
const hidden=(event:PublicActivity)=>event.kind==='reasoning'||event.kind==='terminal'||event.tool==='finish';
const isTask=(event:PublicActivity)=>event.tool==='delegate'&&event.id.startsWith('worker:');

function StatusIcon({status,running}:{status:string;running:boolean}){
 return status==='complete'?<Check size={13}/>:running&&live(status)?<LoaderCircle size={13} className="spin"/>:['failed','interrupted'].includes(status)?<AlertCircle size={13}/>:<span className="activity-dot"/>;
}

function items(events:PublicActivity[],all:PublicActivity[]):Item[]{
 const out:Item[]=[];
 for(const event of events){
  if(hidden(event))continue;
  // A delegation is shown through its task rows once its workers start.
  if(event.tool==='delegate'&&event.id.startsWith('tool:')&&all.some(e=>e.id.startsWith('worker:'+event.id.slice(5)+':')))continue;
  if(event.kind==='commentary'){out.push({kind:'prose',event});continue;}
  if(isTask(event)){out.push({kind:'task',event});continue;}
  const last=out.at(-1);if(last?.kind==='actions')last.events.push(event);else out.push({kind:'actions',events:[event]});
 }
 return out;
}

function Action({event,running}:{event:PublicActivity;running:boolean}){
 const changes=editingChanges(event.changes??[]),text=editingActivity(event),icon=<StatusIcon status={event.status} running={running}/>;
 return <div className={'run-event '+event.status} data-event-id={event.id}>{changes.length||event.media?.length?<details className="run-event-details"><summary>{icon}<span>{text}</span><ChevronRight className="run-disclosure" size={12}/></summary>{!!changes.length&&<ul>{changes.map((change,n)=><li key={n}>{change}</li>)}</ul>}{event.media?.map(media=><div className="run-media" key={media.id}><span>{media.kind==='audio'?'Audio':media.kind==='image'?'Image':'Visual'}</span><strong>{media.name}</strong><small>Added to project media</small></div>)}</details>:<div className="stream-action">{icon}<span>{text}</span></div>}</div>;
}

function Actions({events,running}:{events:PublicActivity[];running:boolean}){
 if(events.length===1)return <Action event={events[0]} running={running}/>;
 const current=running?events.findLast(e=>live(e.status)):undefined,status=current?current.status:events.some(e=>e.status==='failed')?'failed':events.every(e=>e.status==='complete')?'complete':events.at(-1)!.status;
 return <details className={'run-group '+status}><summary><StatusIcon status={status} running={running}/><span>{editingActivity(current??events.at(-1)!)}</span><small>{events.length} steps</small><ChevronRight className="run-disclosure" size={12}/></summary><div className="run-group-items">{events.map(event=><Action key={event.id} event={event} running={running}/>)}</div></details>;
}

function Task({event,all,running}:{event:PublicActivity;all:PublicActivity[];running:boolean}){
 const children=all.filter(e=>e.parent===event.id),shown=children.filter(e=>!hidden(e)),latest=shown.at(-1),working=running&&live(event.status);
 return <details className={'run-task '+event.status} data-event-id={event.id}><summary><StatusIcon status={event.status} running={running}/><span className="run-task-title">{editingActivity(event)}{working&&latest&&<small className="run-task-live">{latest.kind==='commentary'?latest.text:editingActivity(latest)}</small>}</span>{!!shown.length&&<ChevronRight className="run-disclosure" size={12}/>}</summary>{!!shown.length&&<div className="run-task-body"><Items list={items(children,all)} all={all} running={running}/></div>}</details>;
}

function Items({list,all,running}:{list:Item[];all:PublicActivity[];running:boolean}){
 return <>{list.map(item=>item.kind==='prose'?<div key={item.event.id} className="run-progress" data-event-id={item.event.id}>{item.event.text}{running&&item.event.status==='streaming'&&<span className="progress-cursor" aria-hidden="true"/>}</div>:item.kind==='task'?<Task key={item.event.id} event={item.event} all={all} running={running}/>:<Actions key={item.events[0].id} events={item.events} running={running}/>)}</>;
}

export function RunStream({events,running}:{events:PublicActivity[];running:boolean}){
 const all=events.slice().sort((a,b)=>a.sequence-b.sequence),ids=new Set(all.map(e=>e.id)),top=all.filter(e=>!e.parent||!ids.has(e.parent));
 return <div className="run-stream" aria-label="Dream activity"><Items list={items(top,all)} all={all} running={running}/></div>;
}
