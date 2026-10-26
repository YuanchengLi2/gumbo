import {recent,recentTimings,suggestionOutcomes} from './db';
import type {Stats} from '../shared/protocol';
/** The numbers the popup shows, from this computer's own records of the last seven days: how fast the first ghost word
 * came, how many suggestions were taken or dismissed, and what failed. */
export async function stats(now=Date.now()):Promise<Stats>{
 const since=now-7*86_400_000;
 try{
  const [timings,outcomes,failures]=await Promise.all([recentTimings(400,since),suggestionOutcomes(since),recent('failures',5000,since)]);
  const tab=timings.filter(t=>t.surface==='tab').map(t=>t.ms).sort((a,b)=>a-b);
  const at=(q:number)=>tab.length?tab[Math.min(tab.length-1,Math.floor(q*tab.length))]:undefined;
  const byWhat:Record<string,number>={};for(const f of failures)byWhat[f.what]=(byWhat[f.what]??0)+1;
  return{tab:{p50:at(.5),p90:at(.9),samples:tab.length},shown:outcomes.length,accepted:outcomes.filter(s=>s.outcome==='accepted'||s.outcome==='partial').length,dismissed:outcomes.filter(s=>s.outcome==='dismissed').length,failures:failures.length,byWhat};
 }catch{return{tab:{samples:0},shown:0,accepted:0,dismissed:0,failures:0,byWhat:{}};}
}
