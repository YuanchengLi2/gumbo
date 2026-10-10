import {FileApprovalRequired} from './file-tools';
import {BlockedEditError} from './outcomes';
import type {EditOutcome} from '@dream/contracts';
import type {ProjectDB} from '@dream/project-db';
import {parsePlanDocument,validateTaskPlan,type TaskPlan,type WorkflowState} from '@dream/contracts';

export type Workflow=WorkflowState;
export function proposePlan(db:ProjectDB,turnId:string,plan:TaskPlan,selection:string[]){
 const value=validateTaskPlan(plan);db.db.transaction(()=>{db.setMeta('task_plan',JSON.stringify({plan:value,turnId,versionId:db.head(),selection,revision:0}));db.setMeta('ai_status','awaiting_approval');const receipt=`plan_reported:${turnId}`;if(!db.getMeta(receipt)){db.message('assistant','Here’s the plan. You can change the steps before approving.',turnId,{plan:value});db.setMeta(receipt,'1');}})();
}
export function approvePlan(db:ProjectDB,raw:TaskPlan,expectedVersionId:string,requestId:string,expectedPlanRevision?:number){
 const plan=validateTaskPlan(raw),receipt=`plan_approved:${requestId}`;
 return db.db.transaction(()=>{
  const previous=db.getMeta(receipt);if(previous){const saved=JSON.parse(previous);if(saved.plan!==JSON.stringify(plan)||saved.expectedVersionId!==expectedVersionId)throw new Error('This approval ID belongs to a different plan.');return{turnId:saved.turnId as string,replayed:true};}
  const pending=db.getMeta('task_plan');if(!pending)throw new Error('There is no pending plan to approve.');const proposal=JSON.parse(pending);
  if(proposal.versionId!==expectedVersionId||db.head()!==expectedVersionId)throw new Error('The edit changed after this plan was proposed. Refresh the plan before approving.');
  if(expectedPlanRevision!==undefined&&(proposal.revision??0)!==expectedPlanRevision)throw new Error('The plan changed. Reload its saved revision.');
  if(JSON.stringify(proposal.plan)!==JSON.stringify(plan))throw new Error('Save your plan changes before implementing.');
  const workflow:Workflow={turnId:proposal.turnId,plan,selection:proposal.selection??[],approvedVersion:expectedVersionId,cursor:0,status:'approved',completed:[]};
  db.setMeta(`workflow:${workflow.turnId}`,JSON.stringify(workflow));db.setMeta(`route:${workflow.turnId}`,'workflow');db.setMeta('pending_request',JSON.stringify({turnId:workflow.turnId,text:plan.goal,selection:workflow.selection}));db.setMeta('task_plan','');db.setMeta('ai_status','running');db.setMeta(receipt,JSON.stringify({turnId:workflow.turnId,plan:JSON.stringify(plan),expectedVersionId}));return{turnId:workflow.turnId,replayed:false};
 })();
}
export async function executeWorkflow(options:{db:ProjectDB;turnId:string;signal:AbortSignal;execute:(text:string,selection:string[],review:boolean,phase:string)=>Promise<EditOutcome>;publish:(type:string,payload:unknown)=>void}){
 const {db,turnId,signal,execute,publish}=options,key=`workflow:${turnId}`,saved=db.getMeta(key);if(!saved)throw new Error('The approved workflow is missing.');const workflow=JSON.parse(saved) as Workflow;
 const save=()=>{db.setMeta(key,JSON.stringify(workflow));publish('ai.workflow',workflow);};
 if(workflow.status==='complete')return;
 for(;workflow.cursor<workflow.plan.steps.length;){
  signal.throwIfAborted();const step=workflow.plan.steps[workflow.cursor];workflow.status='running';delete workflow.blocked;save();publish('ai.step',{label:step.title,status:'running',detail:`${workflow.cursor+1} of ${workflow.plan.steps.length}`});
  const brief=`Approved goal: ${workflow.plan.goal}\nApproved step titles: ${JSON.stringify(workflow.plan.steps.map(s=>({id:s.id,title:s.title})))}\nShared assumptions: ${JSON.stringify(workflow.plan.assumptions)}\nCompleted steps: ${JSON.stringify(workflow.completed.map(c=>({stepId:c.stepId,versionId:c.versionId,status:c.outcome?.status})))}\nCurrent step: ${step.title}\n${step.instruction}\nAcceptance: ${step.acceptance}\nUse any combination of editing, animation, audio and caption tools that serves this step. Keep previous successful work. Ask the director when a creative or technical decision needs deeper guidance.`;
  let outcome:EditOutcome;
  try{outcome=await execute(brief,workflow.selection,step.review,`workflow-${workflow.cursor}-${step.id}`);if(outcome.status==='blocked')throw new BlockedEditError(outcome);signal.throwIfAborted();}
  catch(error){workflow.status=error instanceof FileApprovalRequired?'waiting_for_permission':'blocked';if(error instanceof FileApprovalRequired)workflow.pendingFileProposalId=error.proposal?.id;if(error instanceof BlockedEditError)workflow.blocked=error.outcome;save();publish('ai.step',{label:step.title,status:'blocked',detail:(error as Error).message});throw error;}
  workflow.completed.push({stepId:step.id,versionId:db.head(),outcome});workflow.cursor++;save();publish('ai.step',{label:step.title,status:'complete'});
 }
 workflow.status='complete';save();
}

export function savePlanDraft(db:ProjectDB,document:string,expectedRevision:number,expectedVersionId:string){
 return db.db.transaction(()=>{const proposal=db.loadState<any>('task_plan');if(!proposal||db.getMeta('ai_status')!=='awaiting_approval')throw new Error('There is no pending plan to edit.');if((proposal.revision??0)!==expectedRevision||proposal.versionId!==expectedVersionId||db.head()!==expectedVersionId)throw new Error('The plan or project changed. Reload the current plan.');proposal.plan=parsePlanDocument(document,proposal.plan);proposal.revision=(proposal.revision??0)+1;db.setMeta('task_plan',JSON.stringify(proposal));return proposal;})();
}
