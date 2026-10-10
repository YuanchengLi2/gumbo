import {z} from 'zod';

const evidence=z.array(z.object({toolCallId:z.string().min(1),finding:z.string().min(1).max(2000)})).max(40);
// Provider tools require an object at the root; discriminated validation remains local.
export const EditReportInputSchema=z.object({
 status:z.enum(['complete','blocked']),summary:z.string().min(1).max(4000),evidence,
 nextAction:z.string().min(1).max(2000).optional().describe('Required when blocked. Explain what is needed to continue.')
});
export const EditOutcomeSchema=z.discriminatedUnion('status',[
 z.object({status:z.literal('complete'),summary:z.string().min(1).max(4000),evidence:evidence.min(1)}),
 z.object({status:z.literal('blocked'),summary:z.string().min(1).max(4000),evidence,nextAction:z.string().min(1).max(2000)})
]);
export type EditOutcome=z.infer<typeof EditOutcomeSchema>;
