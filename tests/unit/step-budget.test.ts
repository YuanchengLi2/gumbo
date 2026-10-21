import {it,expect} from 'vitest';
import {trackBudget,type Budget} from '../../packages/orchestrator/src/step-budget';

/** Roux's sense of budget (step-budget.ts): reminders when a request keeps getting re-published, keeps going long after
 * a publication, or piles up calls; never for finishing or task updates. */
const run=(calls:[string,boolean][],start?:Budget)=>{let budget=start;const reminders:{at:number;text:string}[]=[];
 calls.forEach(([tool,ok],n)=>{const r=trackBudget(budget,tool,ok);budget=r.budget;if(r.reminder)reminders.push({at:n+1,text:r.reminder});});return{budget:budget!,reminders};};

it('reminds at the third publication, and not for failed ones',()=>{
 const {budget,reminders}=run([['publish_project',true],['publish_project',false],['view_media',true],['publish_project',true],['publish_project',true]]);
 expect(budget.publishes).toBe(3);expect(reminders.map(r=>r.at)).toEqual([5]);expect(reminders[0].text).toMatch(/published 3 times.*call finish/);
});

it('reminds once the work runs on eight calls past a publication',()=>{
 const {reminders}=run([['publish_project',true],...Array.from({length:8},()=>['edit_file',true] as [string,boolean])]);
 expect(reminders).toHaveLength(1);expect(reminders[0].at).toBe(9);expect(reminders[0].text).toMatch(/published 8 calls ago/);
});

it('reminds at 40 calls and more firmly at 70; finish and task updates are not counted',()=>{
 const calls=Array.from({length:70},()=>['read_file',true] as [string,boolean]);calls.splice(10,0,['update_tasks',true],['finish',false]);
 const {budget,reminders}=run(calls);
 expect(budget.calls).toBe(70);expect(reminders.map(r=>r.at)).toEqual([42,72]);
 expect(reminders[0].text).toMatch(/40 calls/);expect(reminders[1].text).toMatch(/70 calls.*finish now/);
});

it('says nothing on a short, healthy request',()=>{
 expect(run([['view_media',true],['read_file',true],['write_file',true],['publish_project',true],['finish',true]]).reminders).toEqual([]);
});
