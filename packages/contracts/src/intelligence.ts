import {z} from 'zod';
export const IntelligenceProfileSchema=z.object({version:z.literal(1),role:z.enum(['router','editor','executor','planner','consultation','review']),effort:z.enum(['low','medium','high']),complexity:z.enum(['simple','normal','difficult']),reason:z.string().max(500)});
export type IntelligenceProfile=z.infer<typeof IntelligenceProfileSchema>;
export const ConsultationResultSchema=z.discriminatedUnion('status',[
 z.object({status:z.literal('guidance'),assessment:z.string(),instructions:z.array(z.string()).min(1),checks:z.array(z.string()).default([]),needsUser:z.literal(false)}),
 z.object({status:z.literal('needs_user'),assessment:z.string(),question:z.string().min(1),instructions:z.array(z.string()),needsUser:z.literal(true)})
]);
