import {it,expect} from 'vitest';
import {benchmarkEngine} from '../../scripts/benchmark-engine';
it('keeps retrieval and durable checkpoint writes bounded at the agreed project scale',()=>{
 const result=benchmarkEngine(true);expect(result.recall).toBe(1);expect(result.retrievalP95Ms).toBeLessThanOrEqual(250);expect(result.checkpointP95Ms).toBeLessThanOrEqual(100);expect(result.storage.checkpointReferenceBytes).toBeLessThan(100);
},120000);
