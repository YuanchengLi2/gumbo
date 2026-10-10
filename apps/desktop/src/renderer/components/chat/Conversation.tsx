import {editingChanges} from '../../editing-language';
import {RunStream} from './RunStream';
import React from 'react';
import type {ProjectState,Message,TurnActivity} from '@dream/project-db';
import type {PublicActivity} from '@dream/contracts';
import {DreamMark} from '../home/HomeScreen';
import {MessageText} from './MessageText';
import {useEditor} from '../../store/editor';
import {MediaTile} from '../media/MediaTile';
import type {SelectionRef} from '@dream/timeline';

// Attached media and the timeline selection sent with a message show as media tiles, not names.
function UserMessage({text,assetIds,selection,project}:{text:string;assetIds?:string[];selection?:SelectionRef[];project:ProjectState}){
 const asset=(id?:string)=>id?project.footage.assets.find(a=>a.id===id):undefined;
 return <article className="message user"><div>{(!!assetIds?.length||!!selection?.length)&&<div className="message-attachments">{assetIds?.map(id=><MediaTile key={id} asset={asset(id)} label={asset(id)?.filename??'Media'}/>)}{selection?.map(ref=><MediaTile key={ref.id} asset={asset(ref.assetId)} label={ref.label} srcIn={ref.kind==='caption'?undefined:ref.srcIn} srcOut={ref.srcOut}/>)}</div>}<p>{text}</p></div></article>;
}
const Identity=()=><div className="assistant-identity"><DreamMark/><span>Dream</span></div>;

export function Conversation({project}:{project:ProjectState}){
 const commentary=useEditor(s=>s.commentary),pending=useEditor(s=>s.pending),groups:{id:string;turnId?:string;messages:Message[]}[]=[],byTurn=new Map<string,typeof groups[number]>();
 for(const message of project.messages){const key=message.turnId??message.id;let group=byTurn.get(key);if(!group){group={id:key,turnId:message.turnId,messages:[]};byTurn.set(key,group);groups.push(group);}group.messages.push(message);}
 // A just-sent message is shown at once; until the run picks it up, the previous turn is no longer the live one.
 const waiting=!!pending;
 return <div className="messages conversation">{groups.map(group=>{
 const current=group.turnId===project.experience?.turnId,stored=group.messages.find(m=>m.activity)?.activity,activity:TurnActivity|undefined=current?project.experience?.activity??stored:stored;
 const running=current&&project.aiStatus==='running'&&!waiting,assistants=group.messages.filter(m=>m.role==='assistant'),updates=assistants.filter(m=>(m.report as any)?.kind==='commentary'),last=assistants.filter(m=>(m.report as any)?.kind!=='commentary').at(-1);
 let events:PublicActivity[]=activity?.events?.map(e=>({...e}))??[...(activity?.steps??[]).map((s,i)=>({id:s.id??s.label,sequence:i,kind:'action' as const,text:s.label,status:s.status})),...updates.map((m,i)=>({id:(m.report as any).requestId??m.id,sequence:(activity?.steps.length??0)+i,kind:'commentary' as const,text:m.text,status:'complete'}))];
 if(current)for(const update of commentary.filter(c=>c.turnId===group.turnId)){const found=events.find(e=>e.id===update.requestId);if(found){found.text=update.text;found.status=update.status;}else events.push({id:update.requestId,sequence:events.length,kind:'commentary',text:update.text,status:update.status});}
 // The closing note streams like any other note and hands over to the formatted answer once it is saved, so text never blinks out.
 const answered=!running&&!!last?.text;
 events=events.flatMap(e=>e.kind==='terminal'?answered||!e.text.trim()?[]:[{...e,kind:'commentary' as const}]:[e]).filter(e=>e.status!=='discarded'&&!(e.kind==='commentary'&&answered&&e.text.trim()===last!.text.trim())).sort((a,b)=>a.sequence-b.sequence);
 return <section className="conversation-turn" key={group.id} data-turn={group.turnId}>{group.messages.filter(m=>m.role==='user').map(m=><UserMessage key={m.id} text={m.text} assetIds={m.assetIds} selection={m.selection} project={project}/>)}
 {(events.length>0||last||running)&&<div className="assistant-turn"><Identity/><div className="assistant-turn-body"><RunStream events={events} running={running} assets={project.footage.assets}/>
 {answered&&<div className="turn-answer"><MessageText text={last!.text}/></div>}
 {!running&&!!activity?.changes.length&&<details className="turn-summary" aria-label="Change summary"><summary>Changes<span>{editingChanges(activity.changes).length}</span></summary><ul>{editingChanges(activity.changes).map((change,i)=><li key={i}>{change}</li>)}</ul></details>}
 </div></div>}</section>;
 })}
 {pending&&<section className="conversation-turn pending" data-pending={pending.requestId}><UserMessage text={pending.text} assetIds={pending.assetIds} selection={pending.selection} project={project}/><div className="assistant-turn"><Identity/><div className="assistant-turn-body"><RunStream events={[]} running startedAt={pending.createdAt}/></div></div></section>}
 </div>;
}
