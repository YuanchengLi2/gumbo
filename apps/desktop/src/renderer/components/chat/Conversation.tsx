import {editingChanges} from '../../editing-language';
import {RunStream} from './RunStream';
import React from 'react';
import {Check,LoaderCircle,AlertCircle} from 'lucide-react';
import type {ProjectState,Message,TurnActivity} from '@dream/project-db';
import type {PublicActivity} from '@dream/contracts';
import {DreamMark} from '../home/HomeScreen';
import {MessageText} from './MessageText';
import {useEditor} from '../../store/editor';
export function Conversation({project}:{project:ProjectState}){
 const commentary=useEditor(s=>s.commentary),groups:{id:string;turnId?:string;messages:Message[]}[]=[],byTurn=new Map<string,typeof groups[number]>();
 for(const message of project.messages){const key=message.turnId??message.id;let group=byTurn.get(key);if(!group){group={id:key,turnId:message.turnId,messages:[]};byTurn.set(key,group);groups.push(group);}group.messages.push(message);}
 return <div className="messages conversation">{groups.map(group=>{
 const current=group.turnId===project.experience?.turnId,stored=group.messages.find(m=>m.activity)?.activity,activity:TurnActivity|undefined=current?project.experience?.activity??stored:stored;
 const running=current&&project.aiStatus==='running',assistants=group.messages.filter(m=>m.role==='assistant'),updates=assistants.filter(m=>(m.report as any)?.kind==='commentary'),last=assistants.filter(m=>(m.report as any)?.kind!=='commentary').at(-1);
 let events:PublicActivity[]=activity?.events?.map(e=>({...e}))??[...(activity?.steps??[]).map((s,i)=>({id:s.id??s.label,sequence:i,kind:'action' as const,text:s.label,status:s.status})),...updates.map((m,i)=>({id:(m.report as any).requestId??m.id,sequence:(activity?.steps.length??0)+i,kind:'commentary' as const,text:m.text,status:'complete'}))];
 if(current)for(const update of commentary.filter(c=>c.turnId===group.turnId)){const found=events.find(e=>e.id===update.requestId);if(found){found.text=update.text;found.status=update.status;}else events.push({id:update.requestId,sequence:events.length,kind:'commentary',text:update.text,status:update.status});}
 events=events.filter(e=>e.status!=='discarded'&&!(e.kind==='commentary'&&e.text===last?.text&&!running)).sort((a,b)=>a.sequence-b.sequence);
 return <section className="conversation-turn" key={group.id} data-turn={group.turnId}>{group.messages.filter(m=>m.role==='user').map(m=><article key={m.id} className="message user"><div>{!!m.assetIds?.length&&<div className="message-attachments">{m.assetIds.map(id=><span key={id}>{project.footage.assets.find(a=>a.id===id)?.filename??'Media'}</span>)}</div>}<p>{m.text}</p></div></article>)}
 {(events.length>0||last||running)&&<div className="assistant-turn"><div className="assistant-identity"><DreamMark/><span>Dream</span></div><div className="assistant-turn-body"><RunStream events={events} running={running}/>
 {running&&!events.length&&<div className="chat-thinking"><LoaderCircle size={13} className="spin"/>Understanding your request</div>}
 {!running&&last?.text&&(last.report as any)?.kind!=='completion'&&<div className="turn-answer"><MessageText text={last.text}/></div>}
 {!running&&!!activity?.changes.length&&<details className="turn-summary" aria-label="Change summary"><summary>Saved changes<span>{editingChanges(activity.changes).length}</span></summary><ul>{editingChanges(activity.changes).map((change,i)=><li key={i}>{change}</li>)}</ul></details>}
 </div></div>}</section>;
 })}</div>;
}
