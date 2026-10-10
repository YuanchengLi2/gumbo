import {z} from 'zod';
import {EditOutcomeSchema} from './outcomes';
export const TaskPlanSchema=z.object({
 schemaVersion:z.literal(1),title:z.string().min(1).max(160),goal:z.string().min(1).max(4000),
 steps:z.array(z.object({id:z.string().min(1).max(100),title:z.string().min(1).max(200),instruction:z.string().min(1).max(6000),acceptance:z.string().min(1).max(2000),review:z.boolean().default(false)})).min(1).max(24),
 assumptions:z.array(z.string().max(1000)).max(12).default([])
});
export type TaskPlan=z.infer<typeof TaskPlanSchema>;
export const WorkflowStateSchema=z.object({
 turnId:z.string(),plan:TaskPlanSchema,selection:z.array(z.string()),approvedVersion:z.string(),
 cursor:z.number().int().nonnegative(),status:z.enum(['approved','running','blocked','waiting_for_permission','complete']),blocked:EditOutcomeSchema.optional(),pendingFileProposalId:z.string().optional(),
 completed:z.array(z.object({stepId:z.string(),versionId:z.string(),outcome:EditOutcomeSchema.optional()}))
});
export type WorkflowState=z.infer<typeof WorkflowStateSchema>;
export function validateTaskPlan(raw:unknown){const plan=TaskPlanSchema.parse(raw);if(new Set(plan.steps.map(step=>step.id)).size!==plan.steps.length)throw new Error('Plan step IDs must be unique.');return plan;}

export const WorkTaskSchema=z.object({id:z.string().min(1).max(100),title:z.string().min(1).max(200),status:z.enum(['pending','running','complete','paused','failed']),evidence:z.array(z.string()).max(20).default([])});
// notes: the lead's working plan (decisions, what each task produced, what remains); kept through context compaction.
export const TaskUpdateSchema=z.object({tasks:z.array(WorkTaskSchema).min(1).max(24),notes:z.string().max(3000).optional()});
export type WorkTask=z.infer<typeof WorkTaskSchema>;
export type PublicActivity={id:string;sequence:number;revision?:number;kind:'action'|'commentary'|'reasoning'|'changes'|'terminal';text:string;status:string;requestId?:string;parent?:string;tool?:string;detail?:string;changes?:string[];files?:import('./workspace').SourceChange[];media?:{id:string;name:string;kind:string}[];drafts?:{hash:string;name:string;width:number;height:number;fps:number;durationInFrames:number}[];output?:string;startedAt?:string;updatedAt?:string};

/** A short go-ahead for a waiting plan. Anything with further instructions revises the plan instead. */
export const approvesPlan=(text:string)=>/^(?:(?:ok(?:ay)?|yes|yep|sure|great|perfect|looks good|sounds good|good)[,.!]?\s*)*(?:go(?: ahead)?|do it|edit(?: it)?|make it|build it|apply(?: it| the plan)?|implement(?: it| the plan)?|start|run it|proceed|let'?s go|approve(?:d)?|ship it)?[.!]?\s*$/i.test(text.trim())&&text.trim().length>0;
