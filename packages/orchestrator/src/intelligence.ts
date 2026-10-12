import type {IntelligenceProfile} from '@dream/contracts';
/** Helpers build pieces; the mode stays a parameter so effort can be measured per kind of helper work. */
export type WorkerMode='build';
const levels=['low','medium','high'] as const;
/** extra.lower steps effort down after a response spent its whole allowance thinking. */
export function intelligence(model:string,purpose:string,routing?:{complexity?:string;route?:string;reason?:string},failures=0,chosen?:'low'|'medium'|'high'|'',extra:{workerMode?:WorkerMode;lower?:number}={}):IntelligenceProfile{
 const role=purpose==='routing'?'router':purpose==='execution'||purpose==='worker'?'executor':purpose==='consultation'?'consultation':purpose==='review'?'review':purpose==='planning'||routing?.route==='plan'&&purpose!=='execution'?'planner':'editor';
 const complexity=failures>=2||routing?.complexity==='difficult'?'difficult':routing?.complexity==='simple'?'simple':'normal';
 // Every role thinks at medium effort; the router classifies within a 2K-token allowance, so it stays low.
 const automatic=role==='router'?'low':'medium';
 // An effort the user picked in the composer applies to every model in the request except the router.
 // DREAM_BUILD_WORKER_EFFORT overrides helpers only, for measuring effort against speed, cost and quality.
 const override=purpose==='worker'&&['low','medium','high'].includes(process.env.DREAM_BUILD_WORKER_EFFORT??'')?process.env.DREAM_BUILD_WORKER_EFFORT as 'low'|'medium'|'high':undefined;
 const picked=chosen&&role!=='router'?chosen:override??automatic,effort=extra.lower?levels[Math.max(0,levels.indexOf(picked)-extra.lower)]:picked;
 return{version:1,role,complexity,effort,reason:failures>=2?'Repeated substantive failure requires deeper diagnosis.':routing?.reason??'Match reasoning to the current task.'};
}
/** A task budget the model can see, so it paces itself and finishes instead of being cut off. Router and consultations have none. */
export function taskBudget(purpose:string,workerMode?:WorkerMode):{total:number}|undefined{
 const total=purpose==='worker'?100_000:purpose==='execution'?120_000:purpose==='planning'?60_000:purpose==='answering'?40_000:undefined;
 return total===undefined?undefined:{total:Math.max(20_000,total)};
}
// max_tokens caps thinking plus visible output together. Streaming removes the timeout reason to keep these small.
export const outputAllowance=(p:IntelligenceProfile)=>p.role==='router'?2048:p.effort==='low'?16384:32768;
