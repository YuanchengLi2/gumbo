import {it,expect} from 'vitest';
import {parseCodeTool} from '../../packages/orchestrator/src/code-tools';

/** Too many frame times keep an even spread of the most allowed, first and last included, instead of failing the look. */
it('spreads thirteen frame times over the twelve a look takes',()=>{
 const times=[0,1,2,3,4,5,6,7,8,9,10,11,12],input=parseCodeTool('view_media',{target:'preview',times,progress:'Looking'}) as any;
 expect(input.times).toHaveLength(12);expect(input.times[0]).toBe(0);expect(input.times.at(-1)).toBe(12);
 expect(new Set(input.times).size).toBe(12);
});
