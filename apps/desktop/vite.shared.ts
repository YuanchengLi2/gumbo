import {resolve} from 'node:path';
export const aliases=Object.fromEntries(['timeline','footage','guardrails','contracts','config','project-db','composition','effects','procedural-media','orchestrator','scene-engine'].map(n=>[`@dream/${n}`,resolve(__dirname,`../../packages/${n}/src/index.${n==='composition'?'tsx':'ts'}`)]));
