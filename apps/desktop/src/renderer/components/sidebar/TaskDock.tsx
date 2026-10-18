import {editingActivity,editingTask} from '../../editing-language';
import React,{useEffect,useRef,useState} from 'react';
import {ChevronUp,Check,LoaderCircle,Circle,Pause,AlertCircle} from 'lucide-react';
import {WorkflowStateSchema,type WorkTask,type PublicActivity} from '@dream/contracts';
import type {ProjectState} from '@dream/project-db';
import {useEditor,type UsageRow} from '../../store/editor';
import {useElapsed} from '../chat/RunStream';
import {modelName,ROUX} from '../../models';

const live=(status:string)=>['running','drafting','ready'].includes(status);
const step=(e:PublicActivity)=>(e.kind==='action'||e.kind==='changes')&&e.tool!=='finish';
// What a request has cost, in the credits it is billed in (1 credit = 1 cent of AI cost), never in dollars.
const money=(usd:number)=>{const n=Math.round(usd*100);return usd>0&&n<1?'<1 credit':`${n.toLocaleString()} ${n===1?'credit':'credits'}`;};
const tokens=(n:number)=>n>=1e6?`${(n/1e6).toFixed(1)}M`:n>=1e3?`${Math.round(n/1e3)}K`:String(n);
const seconds=(ms:number)=>{const s=Math.round(ms/1000);return s<60?`${s}s`:`${Math.floor(s/60)}m ${String(s%60).padStart(2,'0')}s`;};
function Icon({status}:{status:string}){return status==='complete'?<Check size={14}/>:live(status)?<i className="spin"><LoaderCircle size={14}/></i>:status==='paused'?<Pause size={14}/>:['failed','interrupted'].includes(status)?<AlertCircle size={14}/>:<Circle size={14}/>;}

/** Monitors the latest request above the composer: what it is doing now, how long it has run, and its tasks. */
export function TaskDock({project}:{project:ProjectState}){
 // A request on Roux 1 (Auto) shows as Roux 1, not the models it runs on.
 const onRoux=useEditor(s=>s.model)==='auto',shown=(id:string)=>onRoux?ROUX:modelName(id);
 // A small bar (what it is doing, time, cost); the full task window opens only when clicked and closes for each new request.
 const [expanded,setExpanded]=useState(false),dock=useRef<HTMLDivElement>(null);
 const pending=useEditor(s=>s.pending),workflow=WorkflowStateSchema.safeParse(project.workflow),active=project.aiStatus==='running',working=active||!!pending;
 const events=pending?[]:project.experience?.activity?.events??[],steps=events.filter(step).sort((a,b)=>a.sequence-b.sequence),elapsed=useElapsed(working,pending?.createdAt??project.experience?.runStartedAt??events[0]?.startedAt);
 let tasks:WorkTask[]=project.experience?.activity?.tasks??[];
 if(workflow.success)tasks=workflow.data.plan.steps.map((step,index)=>({id:step.id,title:step.title,evidence:[],status:workflow.data.completed.some(c=>c.stepId===step.id)?'complete':index===workflow.data.cursor?(active?'running':'paused'):'pending'}));
 tasks=tasks.map(task=>({...task,title:editingTask(task.title)})).map(task=>task.status==='running'&&!active?{...task,status:'paused'}:task);
 // A request just sent has cost nothing yet: until its own first call, the last request's total is not shown as its own.
 const turnId=project.experience?.turnId,usage=useEditor(s=>s.usage),rows:UsageRow[]=usage&&!pending&&usage.turnId===turnId?usage.rows:[];
 // Totals saved with the request load once; live ai.usage events keep them current while it runs.
 useEffect(()=>{if(!turnId)return;let current=true;void window.dream.command({type:'turn_usage',turnId}).then((result:any)=>{if(current&&result?.rows&&useEditor.getState().usage?.turnId!==turnId)useEditor.getState().setUsage({turnId,rows:result.rows.map((r:any)=>({owner:r.owner,model:r.model,calls:r.calls,cost:r.cost??0,prompt:r.prompt??0,output:r.output??0,ms:r.ms??0}))});}).catch(()=>{});return()=>{current=false;};},[turnId]);
 const cost=rows.reduce((n,r)=>n+r.cost,0),owners=[...new Set(rows.map(r=>r.owner))].map(owner=>{const mine=rows.filter(r=>r.owner===owner),title=owner==='main'?undefined:events.find(e=>e.id===owner)?.text;return{owner,label:owner==='main'?'Gumbo':title?editingTask(title):'Helper',models:[...new Set(mine.map(r=>shown(r.model)))].join(' + '),calls:mine.reduce((n,r)=>n+r.calls,0),cost:mine.reduce((n,r)=>n+r.cost,0),tokens:mine.reduce((n,r)=>n+r.prompt+r.output,0),ms:mine.reduce((n,r)=>n+r.ms,0)};});
 useEffect(()=>{setExpanded(false);},[turnId,pending?.requestId]);
 useEffect(()=>{if(!expanded)return;const close=(e:MouseEvent)=>{if(!dock.current?.contains(e.target as Node))setExpanded(false);};document.addEventListener('mousedown',close);return()=>document.removeEventListener('mousedown',close);},[expanded]);
 if(!tasks.length&&!working)return null;
 const completed=tasks.filter(t=>t.status==='complete').length,current=tasks.find(t=>t.status==='running')??tasks.find(t=>t.status==='paused')??tasks.find(t=>t.status==='pending');
 const now=active?steps.findLast(e=>live(e.status)):undefined,label=working?now?editingActivity(now):pending||!steps.length?'Understanding your request':'Thinking':current?.title??'All tasks complete';
 const toggle=(value:boolean)=>setExpanded(value);
 return <div ref={dock} className={'task-dock'+(working?' working':'')} onKeyDown={e=>{if(e.key==='Escape'){toggle(false);e.stopPropagation();}}}>
 <button className="task-dock-toggle" aria-label="Tasks" aria-expanded={expanded} aria-controls="dream-task-window" onClick={()=>toggle(!expanded)}>{working?<i className="spin"><LoaderCircle size={13}/></i>:<Check size={13}/>}<span>{label}</span><small>{[working?elapsed:'',rows.length?money(cost):'',tasks.length?`${completed}/${tasks.length}`:''].filter(Boolean).join(' · ')}</small><ChevronUp size={15} className={expanded?'expanded':''}/></button>
 {expanded&&<section id="dream-task-window" className="task-window" aria-label="Tasks in progress">
  {/* Tasks are the main column, with what the request has cost at its top right; the latest activity runs beside them. */}
  <div className="task-window-main">
   <header><strong>Tasks{tasks.length?<small> {completed} of {tasks.length}</small>:null}</strong>{!!owners.length&&<span className="task-window-cost" title={owners.map(o=>`${o.label} · ${o.models}: ${o.calls} calls · ${tokens(o.tokens)} tokens · ${seconds(o.ms)} · ${money(o.cost)}`).join('\n')}>{money(cost)} · {owners.reduce((n,o)=>n+o.calls,0)} calls · {[...new Set(rows.map(r=>shown(r.model)))].join(' + ')}</span>}</header>
   {tasks.length?<ol>{tasks.map(task=><li key={task.id} className={task.status}><Icon status={task.status}/><span>{task.title}</span><small>{task.status==='complete'?'Done':task.status==='running'?'In progress':task.status==='paused'?'Paused':task.status==='failed'?'Failed':'Pending'}</small></li>)}</ol>:<p className="task-window-empty">{working?'Working without a task list.':'No tasks.'}</p>}
   {owners.length>1&&<ol className="task-window-usage" aria-label="Cost by part">{owners.map(o=><li key={o.owner}><span>{o.label}<small> · {o.models}</small></span><small>{o.calls} calls · {money(o.cost)}</small></li>)}</ol>}
  </div>
  <div className="task-window-side">
   <header><strong>Latest activity</strong><span>{working?'Running · '+elapsed:steps.length?'Finished':'Nothing yet'}</span></header>
   <ol className="task-window-activity">{steps.slice(-6).map(e=><li key={e.id} className={live(e.status)&&active?'running':e.status}><Icon status={live(e.status)&&!active?'paused':e.status}/><span>{editingActivity(e)}</span></li>)}{!steps.length&&<li className="pending">{working?<i className="spin"><LoaderCircle size={14}/></i>:<LoaderCircle size={14}/>}<span>{working?'Understanding your request':'No activity yet'}</span></li>}</ol>
  </div>
 </section>}
 </div>;
}
