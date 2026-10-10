import {editingTask} from '../../editing-language';
import React,{useState} from 'react';
import {ChevronUp,Check,LoaderCircle,Circle,Pause,AlertCircle} from 'lucide-react';
import {WorkflowStateSchema,type WorkTask} from '@dream/contracts';
import type {ProjectState} from '@dream/project-db';
export function TaskDock({project}:{project:ProjectState}){
 const [expanded,setExpanded]=useState(()=>localStorage.getItem('dream-tasks-expanded')==='true');
 const workflow=WorkflowStateSchema.safeParse(project.workflow),active=project.aiStatus==='running';
 let tasks:WorkTask[]=project.experience?.activity?.tasks??[];
 if(workflow.success)tasks=workflow.data.plan.steps.map((step,index)=>({id:step.id,title:step.title,evidence:[],status:workflow.data.completed.some(c=>c.stepId===step.id)?'complete':index===workflow.data.cursor?(active?'running':'paused'):'pending'}));
 if(!tasks.length)return null;
 tasks=tasks.map(task=>({...task,title:editingTask(task.title)}));
 tasks=tasks.map(task=>task.status==='running'&&!active?{...task,status:'paused'}:task);
 const completed=tasks.filter(t=>t.status==='complete').length,current=tasks.find(t=>t.status==='running')??tasks.find(t=>t.status==='paused')??tasks.find(t=>t.status==='pending');
 const toggle=(value:boolean)=>{setExpanded(value);localStorage.setItem('dream-tasks-expanded',String(value));};
 return <div className="task-dock" onKeyDown={e=>{if(e.key==='Escape'){toggle(false);e.stopPropagation();}}}>
 <button className="task-dock-toggle" aria-label="Tasks" aria-expanded={expanded} aria-controls="dream-task-window" onClick={()=>toggle(!expanded)}><span>{current?.title??'All tasks complete'}</span><small>{completed}/{tasks.length}</small><ChevronUp size={15} className={expanded?'expanded':''}/></button>
 {expanded&&<section id="dream-task-window" className="task-window" aria-label="Tasks in progress"><header><strong>Tasks</strong><span>{completed} of {tasks.length} complete</span></header><ol>{tasks.map(task=><li key={task.id} className={task.status}>{task.status==='complete'?<Check size={14}/>:task.status==='running'?<LoaderCircle size={14} className="spin"/>:task.status==='paused'?<Pause size={14}/>:task.status==='failed'?<AlertCircle size={14}/>:<Circle size={14}/>}<span>{task.title}</span><small>{task.status==='complete'?'Done':task.status==='running'?'In progress':task.status==='paused'?'Paused':task.status==='failed'?'Failed':'Pending'}</small></li>)}</ol></section>}
 </div>;
}
