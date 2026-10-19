import {editingChanges} from '../../editing-language';
import {TurnActions,CopyButton} from './TurnActions';
import {RunStream,clock} from './RunStream';
import React from 'react';
import {ChevronRight} from 'lucide-react';
import type {ProjectState,Message,TurnActivity} from '@dream/project-db';
import type {PublicActivity} from '@dream/contracts';
import {MessageText} from './MessageText';
import {ChangeCards} from './ChangeCards';
import {useEditor,type LiveCommentary} from '../../store/editor';
import {MediaTile} from '../media/MediaTile';
import type {SelectionRef} from '@dream/timeline';
import type {Asset} from '@dream/footage';
import {sameItems} from '../../memo';

// Attached media and the timeline selection sent with a message show as media tiles, not names.
function UserMessage({text,assetIds,selection,assets}:{text:string;assetIds?:string[];selection?:SelectionRef[];assets:Asset[]}){
 const asset=(id?:string)=>id?assets.find(a=>a.id===id):undefined;
 return <article className="message user"><div>{(!!assetIds?.length||!!selection?.length)&&<div className="message-attachments">{assetIds?.map(id=><MediaTile key={id} asset={asset(id)} label={asset(id)?.filename??'Media'}/>)}{selection?.map(ref=><MediaTile key={ref.id} asset={asset(ref.assetId)} label={ref.label} srcIn={ref.kind==='caption'?undefined:ref.srcIn} srcOut={ref.srcOut}/>)}</div>}<p>{text}</p></div><div className="message-actions"><CopyButton text={text} label="Copy message"/></div></article>;
}

/** A change as a short pill: "Added 7 clips" reads "+7 clips", "Removed a transition" reads "− transition". */
const pill=(change:string)=>change.replace(/^Added (\d+) /,'+$1 ').replace(/^Removed (\d+) /,'−$1 ').replace(/^Added (?:an? |the )?/,'+ ').replace(/^Removed (?:an? |the )?/,'− ');
const steps=(events:PublicActivity[])=>events.filter(e=>e.kind==='action'&&e.tool!=='finish').length;
/** How long a finished request worked: from the message to the last thing it did, leaving out long waits (a plan
 * waiting for approval, a stop before "continue"), so a plan approved hours later does not count the hours. */
const WAIT_MS=10*60_000;
function workedFor(messages:Message[],events:PublicActivity[]){
 const times=[...messages.map(m=>m.createdAt),...events.flatMap(e=>[e.startedAt,e.updatedAt])].map(t=>t?Date.parse(t):NaN).filter(Number.isFinite).sort((a,b)=>a-b);
 if(times.length<2)return undefined;let total=0;for(let n=1;n<times.length;n++){const gap=times[n]-times[n-1];if(gap<WAIT_MS)total+=gap;}
 return clock(total);
}

type Group={id:string;turnId?:string;messages:Message[]};
type TurnProps={group:Group;activity?:TurnActivity;running:boolean;commentary:LiveCommentary[];assets:Asset[];refresh:string;startedAt?:string};
const none:LiveCommentary[]=[];

export function Conversation({project}:{project:ProjectState}){
 const commentary=useEditor(s=>s.commentary),pending=useEditor(s=>s.pending),groups:Group[]=[],byTurn=new Map<string,Group>();
 for(const message of project.messages){const key=message.turnId??message.id;let group=byTurn.get(key);if(!group){group={id:key,turnId:message.turnId,messages:[]};byTurn.set(key,group);groups.push(group);}group.messages.push(message);}
 // A just-sent message is shown at once; until the run picks it up, the previous turn is no longer the live one.
 const waiting=!!pending,assets=project.footage.assets;
 return <div className="messages conversation">{groups.map(group=>{
 const current=group.turnId===project.experience?.turnId,stored=group.messages.find(m=>m.activity)?.activity;
 return <Turn key={group.id} group={group} activity={current?project.experience?.activity??stored:stored} running={current&&project.aiStatus==='running'&&!waiting} commentary={current?commentary.filter(c=>c.turnId===group.turnId):none} assets={assets} refresh={current?project.versionId:'done'} startedAt={current?project.experience?.runStartedAt:undefined}/>;
 })}
 {pending&&<section className="conversation-turn pending" data-pending={pending.requestId}><UserMessage text={pending.text} assetIds={pending.assetIds} selection={pending.selection} assets={assets}/><div className="assistant-turn"><RunStream events={[]} running startedAt={pending.createdAt}/></div></section>}
 </div>;
}

// A turn draws again only when its own messages or activity change: finished turns stay as they are while a new one streams.
const Turn=React.memo(function Turn({group,activity,running,commentary,assets,refresh,startedAt}:TurnProps){
 const assistants=group.messages.filter(m=>m.role==='assistant'),updates=assistants.filter(m=>(m.report as any)?.kind==='commentary'),last=assistants.filter(m=>(m.report as any)?.kind!=='commentary').at(-1);
 // The saved events are shared, not copied, so steps that did not change are not drawn again; a live note replaces its own.
 let events:PublicActivity[]=activity?.events?[...activity.events]:[...(activity?.steps??[]).map((s,i)=>({id:s.id??s.label,sequence:i,kind:'action' as const,text:s.label,status:s.status})),...updates.map((m,i)=>({id:(m.report as any).requestId??m.id,sequence:(activity?.steps.length??0)+i,kind:'commentary' as const,text:m.text,status:'complete'}))];
 for(const update of commentary){const n=events.findIndex(e=>e.id===update.requestId);if(n>=0)events[n]={...events[n],text:update.text,status:update.status};else events.push({id:update.requestId,sequence:events.length,kind:'commentary',text:update.text,status:update.status});}
 // The closing note streams like any other note and hands over to the formatted answer once it is saved, so text never blinks out.
 const answered=!running&&!!last?.text;
 events=events.flatMap(e=>e.kind==='terminal'?answered||!e.text.trim()?[]:[{...e,kind:'commentary' as const}]:[e]).filter(e=>e.status!=='discarded'&&!(e.kind==='commentary'&&answered&&e.text.trim()===last!.text.trim())).sort((a,b)=>a.sequence-b.sequence);
 // While it works the stream is open; once done it folds into one line above the answer, as in Cursor.
 const count=steps(events),shown=events.some(e=>e.kind==='action'&&e.tool!=='finish'||e.kind==='commentary'&&e.text.trim()),time=workedFor(group.messages,events),stopped=['interrupted','failed'].includes(activity?.status??'');
 const changes=!running?editingChanges(activity?.changes??[]):[];
 return <section className="conversation-turn" data-turn={group.turnId}>{group.messages.filter(m=>m.role==='user').map(m=><UserMessage key={m.id} text={m.text} assetIds={m.assetIds} selection={m.selection} assets={assets}/>)}
 {(events.length>0||last||running)&&<div className="assistant-turn">
 {running?<RunStream events={events} running assets={assets} startedAt={startedAt}/>:shown&&<details className="turn-work" open={!answered}><summary><span>{stopped?'Stopped':'Worked'}{time?(stopped?' after ':' for ')+time:''}</span>{count>0&&<small>{count} {count===1?'step':'steps'}</small>}<ChevronRight className="run-disclosure" size={12}/></summary><RunStream events={events} running={false} assets={assets}/></details>}
 {answered&&<div className="turn-answer"><MessageText text={last!.text}/></div>}
 {(()=>{const pills=changes.length>0?<ul className="turn-changes" aria-label="Change summary">{changes.map((change,i)=><li key={i} title={change}>{pill(change)}</li>)}</ul>:null;
  // Edits show as change cards; a request that only touched files keeps its short summary.
  return !running&&group.turnId&&changes.length?<ChangeCards turnId={group.turnId} refresh={refresh} fallback={pills}/>:pills;})()}
 {!running&&group.turnId&&(count>0||answered)&&<TurnActions turnId={group.turnId} request={group.messages.find(m=>m.role==='user')?.text} reply={answered?last!.text:undefined}/>}
 </div>}</section>;
},(a,b)=>a.activity===b.activity&&a.running===b.running&&a.assets===b.assets&&a.refresh===b.refresh&&a.startedAt===b.startedAt&&a.group.id===b.group.id&&sameItems(a.group.messages,b.group.messages)&&sameItems(a.commentary,b.commentary));
