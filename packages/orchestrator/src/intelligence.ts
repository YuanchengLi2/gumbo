import type {IntelligenceProfile} from '@dream/contracts';
/** Helpers build pieces; the mode stays a parameter so effort can be measured per kind of helper work. */
export type WorkerMode='build';
const levels=['low','medium','high','xhigh'] as const;
/** extra.lower steps effort down after a response spent its whole allowance thinking. */
/** The calls that sort a request before any work (triage, and the older routing and parts calls): small, no visible progress. */
export const routerPurposes=new Set(['routing','model_routing','request_parts','triage']);
export function intelligence(model:string,purpose:string,routing?:{complexity?:string;route?:string;reason?:string;difficulty?:number},failures=0,chosen?:'low'|'medium'|'high'|'',extra:{workerMode?:WorkerMode;lower?:number}={}):IntelligenceProfile{
 const role=routerPurposes.has(purpose)?'router':purpose==='execution'||purpose==='worker'?'executor':purpose==='consultation'?'consultation':purpose==='review'?'review':purpose==='planning'||routing?.route==='plan'&&purpose!=='execution'?'planner':'editor';
 const complexity=failures>=2||routing?.complexity==='difficult'?'difficult':routing?.complexity==='simple'?'simple':'normal';
 // The triage's difficulty sets how hard the model thinks: 1 low, 2–4 medium, 5 high, with Haiku one step higher to make
 // up for being the smaller model. Without a score, Sonnet thinks at medium and Haiku at xhigh. The router classifies
 // within a 2K-token allowance, so it stays low.
 const d=Number(routing?.difficulty),scored=d>=1?(d<=1?0:d>=5?2:1)+(model.startsWith('claude-haiku')?1:0):undefined;
 const automatic=role==='router'?'low':scored!==undefined?levels[Math.min(3,scored)]:model.startsWith('claude-haiku')?'xhigh':'medium';
 // An effort the user picked in the composer applies to every model in the request except the router.
 // DREAM_BUILD_WORKER_EFFORT overrides helpers only, for measuring effort against speed, cost and quality.
 const override=purpose==='worker'&&['low','medium','high'].includes(process.env.DREAM_BUILD_WORKER_EFFORT??'')?process.env.DREAM_BUILD_WORKER_EFFORT as 'low'|'medium'|'high':undefined;
 const picked:typeof levels[number]=chosen&&role!=='router'?chosen:override??automatic,effort=extra.lower?levels[Math.max(0,levels.indexOf(picked)-extra.lower)]:picked;
 return{version:1,role,complexity,effort,reason:failures>=2?'Repeated substantive failure requires deeper diagnosis.':routing?.reason??'Match reasoning to the current task.'};
}
/** A task budget the model can see, so it paces itself and finishes instead of being cut off. Router and consultations have none. */
export function taskBudget(purpose:string,workerMode?:WorkerMode):{total:number}|undefined{
 const total=purpose==='worker'?100_000:purpose==='execution'?120_000:purpose==='planning'?60_000:purpose==='answering'?40_000:undefined;
 return total===undefined?undefined:{total:Math.max(20_000,total)};
}
// max_tokens caps thinking plus visible output together. Streaming removes the timeout reason to keep these small.
export const outputAllowance=(p:IntelligenceProfile)=>p.role==='router'?2048:p.effort==='low'?16384:32768;
