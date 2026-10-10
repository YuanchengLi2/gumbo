import {z} from 'zod';
import {GenerationSchema} from '@dream/contracts';
import {ScoreSchema,SoundDesignSchema,arrangeScore} from '@dream/procedural-media';

/** Large creative documents are encoded once as JSON text, not duplicated into every tool grammar. */
export const mediaTools=[{name:'get_media_schema',description:'Read the complete editable score or layered sound schema before composing custom media. Each creation tool accepts the document as JSON text.',input_schema:{type:'object',properties:{kind:{type:'string',enum:['score','sfx']}},required:['kind'],additionalProperties:false}},
 ...GenerationSchema.options.map(schema=>{
  const type=schema.shape.type.value,base=(schema as z.ZodObject<any>).omit({type:true,requestId:true,expectedVersionId:true});
  const input=type==='create_score'||type==='edit_score'?base.extend({document:z.string().describe('JSON-encoded ScoreDocument. Use get_media_schema(score) or an existing get_score document. All notes, sections, instrumentation, automation and bindings are editable.')}):type==='create_sfx'?base.extend({sound:z.string().describe('JSON-encoded SoundDesign. Use get_media_schema(sfx). Compose your own oscillator/noise layers, envelopes, pitch sweeps and panning.')}):base;
  return{name:type,description:type==='edit_score'?'Render a new immutable score revision and replace this score in the timeline. Old versions retain their original audio.':'Create and place original media directly on the timeline at the supplied anchor (default: project start). Custom score/sound tools accept JSON text and allow original composition beyond presets. Do not ask the user to manually add the result. If a concurrent edit prevented placement, inspect the current timeline and finish placement using the returned asset.',input_schema:z.toJSONSchema(input,{target:'draft-7'})};
 })];
export function readMediaSchema(kind:unknown){
 if(kind==='score')return{schema:z.toJSONSchema(ScoreSchema,{target:'draft-7'}),example:arrangeScore({id:'choose-a-unique-id',title:'Example',seed:42,tempo:120,key:0,durationSec:.5,mood:'warm',intensity:.5,instruments:['keys']})};
 if(kind==='sfx')return{schema:z.toJSONSchema(SoundDesignSchema,{target:'draft-7'})};throw new Error('Choose score or sfx.');
}
export function decodeMediaInput(input:Record<string,unknown>){const result={...input};for(const field of ['document','sound'])if(typeof result[field]==='string')result[field]=JSON.parse(result[field] as string);return result;}
