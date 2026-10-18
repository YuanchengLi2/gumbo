import {it,expect} from 'vitest';
import {shouldCompact} from '../../packages/orchestrator/src/inference';

it('compacts only when it pays: not again right after, nor before enough has come in since the last one left the prompt',()=>{
 const base={target:60000,limit:180000,lastCall:-1e9,lastSize:0};
 expect(shouldCompact({...base,count:59000,call:1})).toBe(false);
 expect(shouldCompact({...base,count:61000,call:1})).toBe(true);
 // October 18: a compaction left 47k, so the prompt passed 60k again two calls later. Neither the gap nor the growth allows it.
 const after={...base,lastCall:10,lastSize:47000};
 expect(shouldCompact({...after,count:62000,call:12})).toBe(false);
 expect(shouldCompact({...after,count:65000,call:17})).toBe(false);
 expect(shouldCompact({...after,count:72000,call:17})).toBe(true);
 // A prompt past 1.5 x the target, or the provider's limit, always compacts.
 expect(shouldCompact({...after,count:91000,call:11})).toBe(true);
 expect(shouldCompact({...after,target:150000,limit:120000,count:155000,call:11})).toBe(true);
});
