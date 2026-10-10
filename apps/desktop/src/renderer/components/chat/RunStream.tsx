import {editingActivity,editingChanges} from '../../editing-language';
import React from 'react';
import {Check,LoaderCircle,AlertCircle,ChevronRight} from 'lucide-react';
import type {PublicActivity} from '@dream/contracts';


export function RunStream({events,running}:{events:PublicActivity[];running:boolean}){
 return <div className="run-stream" aria-label="Dream activity">{events.slice().sort((a,b)=>a.sequence-b.sequence).map(event=>{
  if(event.kind==='reasoning')return null;
  if(event.kind==='commentary')return <div key={event.id} className="run-progress" data-event-id={event.id}>{event.text}{running&&event.status==='streaming'&&<span className="progress-cursor" aria-hidden="true"/>}</div>;
  if(event.kind==='terminal'||event.tool==='finish')return null;
  const icon=event.status==='complete'?<Check size={13}/>:running&&['running','drafting'].includes(event.status)?<LoaderCircle size={13} className="spin"/>:['failed','interrupted'].includes(event.status)?<AlertCircle size={13}/>:<span className="activity-dot"/>;
  const changes=editingChanges(event.changes??[]),text=editingActivity(event);
  return <div key={event.id} className={'run-event '+event.status} data-event-id={event.id}>{changes.length||event.media?.length?<details className="run-event-details"><summary>{icon}<span>{text}</span><ChevronRight className="run-disclosure" size={12}/></summary>{!!changes.length&&<ul>{changes.map((change,n)=><li key={n}>{change}</li>)}</ul>}{event.media?.map(media=><div className="run-media" key={media.id}><span>{media.kind==='audio'?'Audio':media.kind==='image'?'Image':'Visual'}</span><strong>{media.name}</strong><small>Saved to project media</small></div>)}</details>:<div className="stream-action">{icon}<span>{text}</span></div>}</div>;
 })}</div>;
}
