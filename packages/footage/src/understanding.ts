import {z} from 'zod';

export const InspectFootageSchema=z.object({assetId:z.string(),startSec:z.number().nonnegative(),endSec:z.number().positive(),detail:z.enum(['preview','overview','normal','motion']).default('normal')}).refine(v=>v.endSec>v.startSec&&(v.detail==='preview'||v.endSec-v.startSec<=(v.detail==='overview'?60:8)),'Preview can span the source; scene-aware overview supports sixty seconds and detailed inspection eight seconds.');
export type InspectFootage=z.infer<typeof InspectFootageSchema>;
export type SourceFrames={assetId:string;fingerprint:string;startSec:number;endSec:number;sampleIntervalSec:number;frames:{timeSec:number;sha256:string;data:string;mimeType:'image/jpeg'}[];coverage:string};
export type SourceInspector=(request:InspectFootage,signal?:AbortSignal)=>Promise<SourceFrames>;

export const ObservationReportSchema=z.object({
 summary:z.string().min(1).max(1600),
 events:z.array(z.object({
  startSec:z.number().nonnegative(),endSec:z.number().nonnegative(),description:z.string().min(1).max(900),
  subjects:z.array(z.string().max(120)).max(8).default([]),objects:z.array(z.string().max(120)).max(12).default([]),
  visibleText:z.array(z.string().max(300)).max(8).default([]),evidenceFrames:z.array(z.number().nonnegative()).min(1).max(16),
  confidence:z.enum(['high','medium','low']),uncertainty:z.string().max(600).default('')
 })).max(16),
 scene:z.object({framing:z.string().max(300),cameraMotion:z.string().max(300),tags:z.array(z.string().max(80)).max(16),energy:z.enum(['low','medium','high']),usableAsBroll:z.boolean()}),
 continuity:z.string().max(1600),
 inspectMore:z.array(z.object({startSec:z.number().nonnegative(),endSec:z.number().positive(),question:z.string().max(500)})).max(2).default([])
});
export type ObservationReport=z.infer<typeof ObservationReportSchema>;
export function validateObservation(value:unknown,frames:SourceFrames){
 const report=ObservationReportSchema.parse(value),has=(time:number)=>frames.frames.some(frame=>Math.abs(frame.timeSec-time)<.001);
 for(const event of report.events){if(event.endSec<event.startSec||event.startSec<frames.startSec-.001||event.endSec>frames.endSec+.001||event.evidenceFrames.some(time=>!has(time)))throw new Error('Visual observation refers to a time or image outside its supplied evidence.');}
 for(const range of report.inspectMore)if(range.startSec<frames.startSec||range.endSec>frames.endSec||range.endSec<=range.startSec||range.endSec-range.startSec>3.75)throw new Error('Closer inspection must be a positive range of at most 3.75 seconds within the supplied window.');
 return report;
}
export function sourceFrameContent(frames:SourceFrames){return[{type:'text',text:JSON.stringify({assetId:frames.assetId,startSec:frames.startSec,endSec:frames.endSec,sampleIntervalSec:frames.sampleIntervalSec,coverage:frames.coverage,evidence:frames.frames.map(({data,mimeType,...frame})=>frame)})},...frames.frames.flatMap(frame=>[{type:'text',text:`Source time ${frame.timeSec.toFixed(3)} seconds`},{type:'image',source:{type:'base64',media_type:frame.mimeType,data:frame.data}}])];}
