import {it,expect} from 'vitest';
import {mediaTools,decodeMediaInput,readMediaSchema} from '../../packages/orchestrator/src/media-tools';
import {GenerationSchema} from '@dream/contracts';
it('exposes complex creative schemas on demand and decodes JSON documents at the model boundary',()=>{
 const tool=mediaTools.find(t=>t.name==='create_score')!;expect((tool.input_schema as any).properties.document.type).toBe('string');
 const read=readMediaSchema('score'),input={document:JSON.stringify(read.example)};const command=GenerationSchema.parse({...decodeMediaInput(input),type:'create_score',requestId:'request',expectedVersionId:'version'});expect(command.type).toBe('create_score');expect(input.document).toEqual(JSON.stringify(read.example));expect(()=>decodeMediaInput({document:'{not json'})).toThrow();
 expect(JSON.stringify(tool)).not.toContain('durationBeats');expect(JSON.stringify(read.schema)).toContain('durationBeats');
});
