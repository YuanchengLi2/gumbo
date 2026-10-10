import {editingActivity,editingTask} from '../../editing-language';
import React,{useState} from 'react';
import {ChevronUp,Check,LoaderCircle,Circle,Pause,AlertCircle} from 'lucide-react';
import {WorkflowStateSchema,type WorkTask,type PublicActivity} from '@dream/contracts';
import type {ProjectState} from '@dream/project-db';
import {useEditor} from '../../store/editor';
import {useElapsed} from '../chat/RunStream';

const live=(status:string)=>['running','drafting','ready'].includes(status);
const step=(e:PublicActivity)=>(e.kind==='action'||e.kind==='changes')&&e.tool!=='finish';
function Icon({status}:{status:string}){return status==='complete'?<Check size={14}/>:live(status)?<LoaderCircle size={14} className="spin"/>:status==='paused'?<Pause size={14}/>:['failed','interrupted'].includes(status)?<AlertCircle size={14}/>:<Circle size={14}/>;}

/** Monitors the latest request above the composer: what it is doing now, how long it has run, and its tasks. */
export function TaskDock({project}:{project:ProjectState}){
 const [expanded,setExpanded]=useState(()=>{try{return localStorage.getItem('dream-tasks-expanded')==='true';}catch{return false;}});
 const pending=useEditor(s=>s.pending),workflow=WorkflowStateSchema.safeParse(project.workflow),active=project.aiStatus==='running',working=active||!!pending;
 const events=pending?[]:project.experience?.activity?.events??[],steps=events.filter(step).sort((a,b)=>a.sequence-b.sequence),elapsed=useElapsed(working,pending?.createdAt??events[0]?.startedAt);
 let tasks:WorkTask[]=project.experience?.activity?.tasks??[];
 if(workflow.success)tasks=workflow.data.plan.steps.map((step,index)=>({id:step.id,title:step.title,evidence:[],status:workflow.data.completed.some(c=>c.stepId===step.id)?'complete':index===workflow.data.cursor?(active?'running':'paused'):'pending'}));
 tasks=tasks.map(task=>({...task,title:editingTask(task.title)})).map(task=>task.status==='running'&&!active?{...task,status:'paused'}:task);
 if(!tasks.length&&!working)return null;
 const completed=tasks.filter(t=>t.status==='complete').length,current=tasks.find(t=>t.status==='running')??tasks.find(t=>t.status==='paused')??tasks.find(t=>t.status==='pending');
 const now=active?steps.findLast(e=>live(e.status)):undefined,label=working?now?editingActivity(now):pending||!steps.length?'Understanding your request':'Thinking':current?.title??'All tasks complete';
 const toggle=(value:boolean)=>{setExpanded(value);try{localStorage.setItem('dream-tasks-expanded',String(value));}catch{}};
 return <div className={'task-dock'+(working?' working':'')} onKeyDown={e=>{if(e.key==='Escape'){toggle(false);e.stopPropagation();}}}>
 <button className="task-dock-toggle" aria-label="Tasks" aria-expanded={expanded} aria-controls="dream-task-window" onClick={()=>toggle(!expanded)}>{working?<LoaderCircle size={13} className="spin"/>:<Check size={13}/>}<span>{label}</span><small>{working&&elapsed}{working&&!!tasks.length&&' · '}{!!tasks.length&&`${completed}/${tasks.length}`}</small><ChevronUp size={15} className={expanded?'expanded':''}/></button>
 {expanded&&<section id="dream-task-window" className="task-window" aria-label="Tasks in progress">
  {!!tasks.length&&<><header><strong>Tasks</strong><span>{completed} of {tasks.length} complete</span></header><ol>{tasks.map(task=><li key={task.id} className={task.status}><Icon status={task.status}/><span>{task.title}</span><small>{task.status==='complete'?'Done':task.status==='running'?'In progress':task.status==='paused'?'Paused':task.status==='failed'?'Failed':'Pending'}</small></li>)}</ol></>}
  <header className={tasks.length?'task-window-section':''}><strong>Latest activity</strong><span>{working?'Running · '+elapsed:steps.length?'Finished':'Nothing yet'}</span></header>
  <ol className="task-window-activity">{steps.slice(-6).map(e=><li key={e.id} className={live(e.status)&&active?'running':e.status}><Icon status={live(e.status)&&!active?'paused':e.status}/><span>{editingActivity(e)}</span></li>)}{!steps.length&&<li className="pending"><LoaderCircle size={14} className={working?'spin':''}/><span>{working?'Understanding your request':'No activity yet'}</span></li>}</ol>
 </section>}
 </div>;
}
