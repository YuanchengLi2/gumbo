import {z} from 'zod';
export const InstrumentSchema=z.enum(['pad','bass','pluck','lead','keys','kick','snare','hat','tom','shaker','cymbal','riser','impact']);
export type Instrument=z.infer<typeof InstrumentSchema>;
const PointSchema=z.object({beat:z.number().nonnegative(),value:z.number().finite()});
export const NoteSchema=z.object({id:z.string().min(1),beat:z.number().nonnegative(),durationBeats:z.number().positive(),pitch:z.number().int().min(0).max(127),velocity:z.number().min(0).max(1),sectionId:z.string().optional()});
export const TrackSchema=z.object({id:z.string().min(1),name:z.string().min(1).max(80),instrument:InstrumentSchema,gainDb:z.number().min(-60).max(12).default(0),pan:z.number().min(-1).max(1).default(0),mute:z.boolean().default(false),notes:z.array(NoteSchema).max(50000),automation:z.array(z.object({target:z.enum(['gainDb','pan','brightness']),points:z.array(PointSchema).min(1).max(256)})).max(3).default([])});
export const SectionSchema=z.object({id:z.string().min(1),name:z.string().max(80),kind:z.enum(['intro','body','build','break','ending']),startBeat:z.number().nonnegative(),durationBeats:z.number().positive(),intensity:z.number().min(0).max(1)});
export const BindingSchema=z.object({sectionId:z.string(),beatId:z.string(),offsetSec:z.number().default(0),followDuration:z.boolean().default(true)});
export const ScoreSchema=z.object({schemaVersion:z.literal(2),id:z.string().min(1),title:z.string().min(1).max(120),seed:z.number().int(),tempo:z.number().min(40).max(200),meter:z.object({beatsPerBar:z.number().int().min(2).max(12),beatUnit:z.union([z.literal(4),z.literal(8)])}),key:z.number().int().min(0).max(11),mode:z.enum(['major','minor']),durationSec:z.number().positive().max(600),mood:z.enum(['calm','bright','cinematic','pulse','warm']),intensity:z.number().min(0).max(1),sections:z.array(SectionSchema).min(1).max(100),tracks:z.array(TrackSchema).min(1).max(16),bindings:z.array(BindingSchema).max(100).default([])}).superRefine((score,context)=>{
 const sectionIds=new Set<string>(),trackIds=new Set<string>();
 for(const section of score.sections){if(sectionIds.has(section.id))context.addIssue({code:'custom',message:'Section IDs must be unique.'});sectionIds.add(section.id);}
 for(const binding of score.bindings)if(!sectionIds.has(binding.sectionId))context.addIssue({code:'custom',message:'A binding refers to an unknown section.'});
 for(const track of score.tracks){
  if(trackIds.has(track.id))context.addIssue({code:'custom',message:'Track IDs must be unique.'});trackIds.add(track.id);const noteIds=new Set<string>(),targets=new Set<string>();
  for(const note of track.notes){if(noteIds.has(note.id)||note.sectionId&&!sectionIds.has(note.sectionId))context.addIssue({code:'custom',message:'Notes need unique IDs and valid section references.'});noteIds.add(note.id);}
  for(const automation of track.automation){if(targets.has(automation.target))context.addIssue({code:'custom',message:'Use one automation lane per target.'});targets.add(automation.target);for(let n=0;n<automation.points.length;n++){const p=automation.points[n],range=automation.target==='gainDb'?[-60,12]:automation.target==='pan'?[-1,1]:[0,1];if(p.value<range[0]||p.value>range[1]||n>0&&p.beat<=automation.points[n-1].beat)context.addIssue({code:'custom',message:'Automation points need increasing beats and values within the target range.'});}}
 }
});
export type ScoreDocument=z.infer<typeof ScoreSchema>;
export type ScoreTrack=z.infer<typeof TrackSchema>;
export const ScoreOptionsSchema=z.object({id:z.string(),title:z.string().default('Original score'),seed:z.number().int(),tempo:z.number().min(40).max(200),key:z.number().int().min(0).max(11),durationSec:z.number().positive().max(600),mood:z.enum(['calm','bright','cinematic','pulse','warm']),intensity:z.number().min(0).max(1),instruments:z.array(z.enum(['pad','bass','pluck','lead','keys','drums'])).min(1),buildAtSec:z.number().optional()});
export type ScoreOptions=z.input<typeof ScoreOptionsSchema>;
export const SCORE_RENDERER_VERSION='dream-score-3';
/** A layer may leave out what has an obvious value: its id (layer-1, layer-2, ...), when it starts, its pan, its end
 * pitch (no sweep), its envelope and its filter (open). Any model writing a sound then gets a working sound, not an error. */
function soundLayerDefaults(value:unknown){
 if(!Array.isArray(value))return value;
 return value.map((layer,n)=>layer&&typeof layer==='object'?{startSec:0,pan:0,gainDb:-6,attackSec:.01,releaseSec:.1,filterHz:20000,...layer,id:typeof (layer as any).id==='string'&&(layer as any).id?(layer as any).id:`layer-${n+1}`,endFrequencyHz:(layer as any).endFrequencyHz??(layer as any).frequencyHz}:layer);
}
export const SoundDesignSchema=z.object({schemaVersion:z.literal(1),id:z.string().min(1),title:z.string().min(1).max(120),seed:z.number().int(),durationSec:z.number().positive().max(30),layers:z.preprocess(soundLayerDefaults,z.array(z.object({id:z.string().min(1),wave:z.enum(['sine','triangle','saw','square','noise']),startSec:z.number().nonnegative(),durationSec:z.number().positive().max(30),frequencyHz:z.number().min(20).max(20000),endFrequencyHz:z.number().min(20).max(20000),gainDb:z.number().min(-60).max(6),pan:z.number().min(-1).max(1),attackSec:z.number().nonnegative(),releaseSec:z.number().nonnegative(),filterHz:z.number().min(20).max(20000)})).min(1).max(32))}).superRefine((sound,context)=>{
 // One issue per layer and rule, with the numbers, so a whole sound can be fixed in one pass.
 const seen=new Map<string,number>(),s=(n:number)=>`${Math.round(n*1000)/1000} s`;
 sound.layers.forEach((layer,n)=>{
  const at=['layers',n],name=`layer ${n} (${layer.id})`,end=layer.startSec+layer.durationSec;
  if(seen.has(layer.id))context.addIssue({code:'custom',path:[...at,'id'],message:`${name} has the same id as layer ${seen.get(layer.id)}; give each layer its own id.`});else seen.set(layer.id,n);
  if(end>sound.durationSec+.00001)context.addIssue({code:'custom',path:[...at,'durationSec'],message:`${name} starts at ${s(layer.startSec)} and lasts ${s(layer.durationSec)}, so it ends at ${s(end)}, after the sound ends at ${s(sound.durationSec)}; shorten the layer to at most ${s(sound.durationSec-layer.startSec)} or set the sound's durationSec to at least ${s(end)}.`});
  if(layer.attackSec+layer.releaseSec>layer.durationSec)context.addIssue({code:'custom',path:[...at,'attackSec'],message:`${name}'s attackSec (${s(layer.attackSec)}) plus releaseSec (${s(layer.releaseSec)}) is ${s(layer.attackSec+layer.releaseSec)}, longer than the layer (${s(layer.durationSec)}); make them add up to at most its durationSec.`});
 });
});
export type SoundDesign=z.infer<typeof SoundDesignSchema>;
/** Every problem a schema found, one line each with where it is ("layers.1.pan: expected a number"), so a file can be
 * fixed in one pass instead of one error at a time. */
export function describeIssues(error:unknown,fallback='document',limit=12):string{
 const issues=(error as {issues?:{path:PropertyKey[];message:string}[]})?.issues;
 if(!issues?.length)return String((error as Error)?.message??error);
 const lines=issues.slice(0,limit).map(i=>`${i.path.map(String).join('.')||fallback}: ${i.message}`);
 return lines.join('\n')+(issues.length>limit?`\n(and ${issues.length-limit} more)`:'');
}
