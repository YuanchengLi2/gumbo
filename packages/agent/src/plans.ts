import type {ProjectDB} from '@dream/project-db';
import {parsePlanDocument,validateTaskPlan,type TaskPlan} from '@dream/contracts';

/** Plan mode's records, as the app's plan card reads them: the proposal waits in task_plan with ai_status
 * awaiting_approval; the user may change its steps (savePlanDraft) and approves it. Approval is not a separate machine:
 * the same conversation carries on and does the work, with the plan as the user approved it. */
export function proposePlan(db:ProjectDB,turnId:string,raw:TaskPlan,selection:string[]){
 const plan=validateTaskPlan(raw);
 db.db.transaction(()=>{
  db.setMeta('task_plan',JSON.stringify({plan,turnId,versionId:db.head(),selection,revision:0}));db.setMeta('ai_status','awaiting_approval');
  const receipt=`plan_reported:${turnId}`;if(!db.getMeta(receipt)){db.message('assistant','Here’s the plan. You can change the steps before approving.',turnId,{plan});db.setMeta(receipt,'1');}
 })();
 return plan;
}
/** Checks an approval against the waiting proposal and takes it out of waiting. The same approval id twice is one approval. */
export function acceptPlan(db:ProjectDB,raw:TaskPlan,expectedVersionId:string,requestId:string,expectedPlanRevision?:number):{turnId:string;plan:TaskPlan;selection:string[];replayed:boolean}{
 const plan=validateTaskPlan(raw),receipt=`plan_approved:${requestId}`;
 return db.db.transaction(()=>{
  const previous=db.getMeta(receipt);
  if(previous){const saved=JSON.parse(previous);if(saved.plan!==JSON.stringify(plan)||saved.expectedVersionId!==expectedVersionId)throw new Error('This approval ID belongs to a different plan.');return{turnId:saved.turnId,plan,selection:saved.selection??[],replayed:true};}
  const pending=db.getMeta('task_plan');if(!pending)throw new Error('There is no plan waiting for approval.');const proposal=JSON.parse(pending);
  if(proposal.versionId!==expectedVersionId||db.head()!==expectedVersionId)throw new Error('The edit changed after this plan was proposed. Ask for the plan again.');
  if(expectedPlanRevision!==undefined&&(proposal.revision??0)!==expectedPlanRevision)throw new Error('The plan changed. Reload its saved version.');
  if(JSON.stringify(proposal.plan)!==JSON.stringify(plan))throw new Error('Save your changes to the plan before approving it.');
  db.setMeta('task_plan','');db.setMeta(receipt,JSON.stringify({turnId:proposal.turnId,plan:JSON.stringify(plan),expectedVersionId,selection:proposal.selection??[]}));
  return{turnId:proposal.turnId,plan,selection:proposal.selection??[],replayed:false};
 })();
}
/** The user's own changes to a waiting plan, as written in the plan card. */
export function savePlanDraft(db:ProjectDB,document:string,expectedRevision:number,expectedVersionId:string){
 return db.db.transaction(()=>{
  const proposal=db.loadState<any>('task_plan');
  if(!proposal||db.getMeta('ai_status')!=='awaiting_approval')throw new Error('There is no plan waiting to edit.');
  if((proposal.revision??0)!==expectedRevision||proposal.versionId!==expectedVersionId||db.head()!==expectedVersionId)throw new Error('The plan or the project changed. Reload the current plan.');
  proposal.plan=parsePlanDocument(document,proposal.plan);proposal.revision=(proposal.revision??0)+1;db.setMeta('task_plan',JSON.stringify(proposal));return proposal;
 })();
}
/** The approved plan as the message that tells the conversation to carry it out. */
export function approvedPlanMessage(plan:TaskPlan){
 return `I approve the plan. Carry it out now.\n\nGoal: ${plan.goal}\n${plan.steps.map((s,n)=>`${n+1}. [${s.id}] ${s.title}: ${s.instruction} (done when: ${s.acceptance})`).join('\n')}${plan.assumptions.length?`\nAssumptions: ${plan.assumptions.join('; ')}`:''}\n\nThe steps are your task list: mark each as you go with todo, by its id.`;
}
/** The approved plan's steps as the task list the user watches, all still to do. */
export const planTasks=(plan:TaskPlan)=>plan.steps.map(s=>({id:s.id,title:s.title,status:'pending' as const,evidence:[] as string[]}));
