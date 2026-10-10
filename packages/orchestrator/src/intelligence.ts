import type {IntelligenceProfile} from '@dream/contracts';
export function intelligence(model:string,purpose:string,routing?:{complexity?:string;route?:string;reason?:string},failures=0):IntelligenceProfile{
 const role=purpose==='routing'?'router':purpose==='execution'||purpose==='worker'||purpose==='lead'?'executor':purpose==='consultation'?'consultation':purpose==='review'?'review':purpose==='planning'||routing?.route==='plan'&&purpose!=='execution'?'planner':'editor';
 const complexity=failures>=2||routing?.complexity==='difficult'?'difficult':routing?.complexity==='simple'?'simple':'normal';
 return{version:1,role,complexity,effort:role==='router'||complexity==='simple'&&role!=='consultation'?'low':complexity==='difficult'?'high':'medium',reason:failures>=2?'Repeated substantive failure requires deeper diagnosis.':routing?.reason??'Match reasoning to the current task.'};
}
// max_tokens caps thinking plus visible output together. Streaming removes the timeout reason to keep these small.
export const outputAllowance=(p:IntelligenceProfile)=>p.role==='router'?2048:p.effort==='low'?16384:32768;
export function substantiveFailure(error:unknown){return !/abort|cancel|sign in|session expired|authentication|quota|budget|unavailable|missing source|relink|connection|overload|rate.limit/i.test(String((error as Error)?.message??error));}
