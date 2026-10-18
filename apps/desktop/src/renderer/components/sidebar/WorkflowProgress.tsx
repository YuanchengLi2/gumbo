import React from 'react';
import {Check,Circle,AlertCircle,LoaderCircle} from 'lucide-react';
import type {WorkflowState} from '@dream/contracts';

export function WorkflowProgress({workflow,active}:{workflow:WorkflowState;active:boolean}){
 return <div className="plan-checklist" aria-label="Approved plan progress">{workflow.plan.steps.map((step,index)=>{
  const done=workflow.completed.some(receipt=>receipt.stepId===step.id),current=index===workflow.cursor;
  const status=done?'complete':current?(active?'running':'blocked'):'pending';
  return <div key={step.id} className={`plan-step workflow-step ${status}`}><div className="step-line">
   {done?<span className="completed-icon"><Check size={12}/></span>:status==='running'?<i className="spin"><LoaderCircle size={17}/></i>:status==='blocked'?<AlertCircle size={17}/>:<Circle size={17}/>}
   <span>{step.title}</span><small>{done?'Complete':status==='blocked'?(workflow.status==='waiting_for_permission'?'Needs permission':'Paused'):status==='pending'?'Queued':'In progress'}</small>
  </div>{current&&!done&&<p>{workflow.blocked?.status==='blocked'?workflow.blocked.nextAction:step.acceptance}</p>}</div>;
 })}</div>;
}
