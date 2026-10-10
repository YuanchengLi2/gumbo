import {BlockedEditError} from './outcomes';
import {z} from 'zod';
import type {ProjectDB} from '@dream/project-db';
import {models} from '@dream/config';
import {readLoop} from './read-loop';
import {designDirection} from './design';

export const consultTool={name:'consult_director',description:'Ask the director for deeper creative or technical guidance during any editing step. Use for competing creative choices, difficult motion/audio design, repeated failed approaches or a needed plan adjustment. The director can inspect footage and return targeted instructions; execution remains in this same turn.',input_schema:{type:'object',properties:{question:{type:'string'},attempts:{type:'string'}},required:['question'],additionalProperties:false}};
const AdviceSchema=z.object({assessment:z.string(),instructions:z.array(z.string()).min(1).max(12),designSystem:z.object({concept:z.string(),palette:z.string(),typography:z.string(),motion:z.string(),audio:z.string()}).optional(),checks:z.array(z.string()).max(8).default([]),question:z.string().max(2000).optional(),needsUser:z.boolean().default(false)});
export async function consultDirector(options:{db:ProjectDB;turnId:string;key:string;question:string;attempts?:string;context:string;signal?:AbortSignal;inference:Parameters<typeof readLoop>[0]['inference']}){
 const question=z.string().min(1).max(12000).parse(options.question);
 const feedback=options.db.loadState<{count:number;text:string}>('resume_input:'+options.turnId);
 const blockedKey=`consult-blocked:${options.turnId}:${options.key}`,blocked=options.db.loadState<any>(blockedKey);
 const answered=blocked&&feedback&&feedback.count>(blocked.feedbackCount??0);
 const suffix=answered?':answer:'+feedback.count:'';
 const answer=await readLoop({db:options.db,key:`consult:${options.turnId}:${options.key}${suffix}`,turnId:options.turnId,signal:options.signal,inference:options.inference,model:models.director,
  system:designDirection+'\nYou are Opus, the director collaborating with Dream’s executing Sonnet editor. Resolve the specific question using retrieved evidence. Do not restate the brief or offer generic encouragement. For creative design, supply a coherent designSystem with concrete palette, typography, motion timing and audio choices; omit it for purely technical issues. Give ordered implementable instructions, explain the key tradeoff and include explicit checks for the editor to verify. Inspect missing relevant project records with scoped reads. Match scope: a small technical question needs a short precise answer. You may direct any combination of coded motion, composition, audio and editing; the editor implements it through one engine. Preserve approved intent and completed work. Never claim unseen or unheard evidence. Set needsUser only for essential missing intent or a material departure from approval. Use submit_guidance.',
  prompt:`${answered?'User response to your required decision: '+feedback.text+'\n':''}Editor question: ${question}\nAttempts and evidence: ${(options.attempts??'').slice(0,16000)}\nProject: ${options.context}`,
  finish:{name:'submit_guidance',tool:{name:'submit_guidance',description:'Return targeted guidance to the executing editor.',input_schema:z.toJSONSchema(AdviceSchema,{target:'draft-7'})},parse:input=>AdviceSchema.parse(input)}
 });
 const advice=(answer.value??{assessment:answer.text,instructions:[answer.text],needsUser:false}) as z.infer<typeof AdviceSchema>;
 if(advice.needsUser){const question=advice.question??advice.instructions[0]??advice.assessment;const outcome={status:'blocked' as const,summary:advice.assessment,nextAction:question,evidence:[]};if(!blocked||answered)options.db.db.transaction(()=>{options.db.saveState(blockedKey,{question,feedbackCount:feedback?.count??0});options.db.message('assistant',question,options.turnId,{outcome});})();throw new BlockedEditError(outcome);}
 return{...advice,status:'guidance' as const};
}
