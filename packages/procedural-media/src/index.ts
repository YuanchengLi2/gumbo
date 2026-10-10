export * from './schema';
export * from './score';
export * from './catalog';
export * from './sfx';
export * from './synth';
export * from './wav';
import {arrangeScore} from './score';
import {renderArrangement} from './synth';
import type {ScoreDocument,ScoreOptions} from './schema';
export function renderScore(input:ScoreDocument|ScoreOptions){return renderArrangement('schemaVersion' in input?input:arrangeScore(input));}
