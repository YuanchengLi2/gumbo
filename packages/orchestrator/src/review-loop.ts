import {BlockedEditError} from './outcomes';
import {z} from 'zod';
import {ReviewImagesSchema,ReviewReportSchema,type ReviewRenderer,type ReviewReport} from '@dream/contracts';
import type {ProjectDB} from '@dream/project-db';
import {models} from '@dream/config';
import {reviewPacket} from './review-packet';
import {designDirection} from './design';

type Round={versionId:string;report?:ReviewReport;status:'rendering'|'reviewed'|'repairing'|'repaired'};
type ReviewCheckpoint={rounds:Round[];done:boolean;blocked?:{summary:string;nextAction:string}};
type Inference=(model:string,system:string,messages:unknown[],tools:unknown[],turnId:string)=>Promise<{content:{type:string;name?:string;input?:unknown}[]}>;

export async function reviewLoop(options:{db:ProjectDB;turnId:string;checkpointKey?:string;brief:string;signal:AbortSignal;render:ReviewRenderer;inference:Inference;repair:(instruction:string,phase:string)=>Promise<void>;step:(label:string,status?:string,detail?:string)=>void}){
 const {db,turnId,brief,signal,render,inference,repair,step}=options,key=options.checkpointKey??`review:${turnId}`;
 const saved=db.loadState<ReviewCheckpoint>(key);const checkpoint:ReviewCheckpoint=saved?saved:{rounds:[],done:false};
 const save=()=>db.saveState(key,checkpoint);
 if(checkpoint.done){if(checkpoint.blocked)throw new BlockedEditError({status:'blocked',...checkpoint.blocked,evidence:[]});return;}
 for(let n=0;n<2;n++){
  signal.throwIfAborted();let round=checkpoint.rounds[n];
  if(round?.status==='repaired')continue;
  if(!round?.report||(round.status==='reviewed'&&round.versionId!==db.head())){
   const state={versionId:db.head(),timeline:db.timeline(),footage:db.footage()};round={versionId:state.versionId,status:'rendering'};checkpoint.rounds[n]=round;save();
   step(`Reviewing the edit · ${n+1}/2`,'running','Rendering opening, cut and effect frames');
   const packet=reviewPacket(state.versionId,state.timeline,state.footage);
   const images=ReviewImagesSchema.parse(await render(packet.request,signal));signal.throwIfAborted();
   if(images.versionId!==state.versionId||images.frames.length!==packet.request.frames.length||images.frames.some((f,i)=>f.frame!==packet.request.frames[i].frame))throw new Error('Review images do not match the requested version and frames.');
   if(db.head()!==state.versionId)throw new Error('The edit changed during review. Resume to review the latest saved version.');
   const content:unknown[]=[{type:'text',text:`User brief: ${brief}\nEvidence: ${JSON.stringify(packet.evidence)}`}];
   for(const frame of images.frames){content.push({type:'text',text:`Frame ${frame.frame}: ${frame.labels.join('; ')}`},{type:'image',source:{type:'base64',media_type:frame.mimeType,data:frame.data}});}
   const response=await inference(models.editor,designDirection+'\nYou are Dream’s reviewer. Review the actual rendered frames and accompanying cut sheet, transcript, story beats and audio manifest against the user brief. Images are sparse samples, not a playback recording. Do not claim you heard audio or watched motion. Identify concrete visible or structural problems, with exact affected item IDs and evidence frames where applicable. Repair only problems supported by this evidence; uncertain or unavailable evidence is a warning. Avoid unnecessary cosmetic edits. Use submit_review with a brief user-facing summary and issues; an empty issues array is valid.',[{role:'user',content}],[{name:'submit_review',description:'Record a review of the version and rendered evidence.',input_schema:z.toJSONSchema(ReviewReportSchema,{target:'draft-7'})}],turnId);
   signal.throwIfAborted();if(db.head()!==state.versionId)throw new Error('The edit changed while the review was running. Resume to review the latest version.');
   const report=ReviewReportSchema.parse(response.content.find(c=>c.type==='tool_use'&&c.name==='submit_review')?.input);
   const ids=new Set([...state.timeline.spine,...state.timeline.attached,...state.timeline.music].map(i=>i.id));
   if(report.issues.some(i=>i.itemIds.some(id=>!ids.has(id))||i.frame!==undefined&&!images.frames.some(f=>f.frame===i.frame)))throw new Error('The review referenced an item or frame outside its evidence. Resume to retry the review.');
   round.report=report;round.status='reviewed';
   db.db.transaction(()=>{save();db.message('assistant',report.summary,turnId,{review:{round:n+1,versionId:state.versionId,issues:report.issues,frames:images.frames.map(({data,...frame})=>frame)}});})();
  }
  step(`Reviewing the edit · ${n+1}/2`,'complete');
  const repairs=round.report!.issues.filter(i=>i.severity==='repair');
  if(!repairs.length||n===1||Number(db.getMeta(`tool_count:${turnId}`)??0)>=40){checkpoint.done=true;if(repairs.length)checkpoint.blocked={summary:'Required review findings remain unresolved.',nextAction:repairs.map(r=>r.problem).join('; ').slice(0,2000)};save();if(checkpoint.blocked){const outcome={status:'blocked' as const,...checkpoint.blocked,evidence:[]};db.message('assistant',outcome.summary,turnId,{outcome});throw new BlockedEditError(outcome);}step('Review complete','complete',repairs.length?'Review findings remain in the report.':'No required repairs found.');return;}
  if(round.status==='reviewed'&&db.head()!==round.versionId)throw new Error('The edit changed after review. Start a new request to review these changes before applying repairs.');
  round.status='repairing';save();
  await repair(`Repair the following evidence-backed review findings while preserving the brief and successful edits. Read the current project before applying changes. Do not invent evidence or introduce unrelated improvements.\nBrief: ${brief}\nReviewed version: ${round.versionId}\n${JSON.stringify(repairs)}`,`review-repair-${n+1}`);
  signal.throwIfAborted();round.status='repaired';save();
 }
}
