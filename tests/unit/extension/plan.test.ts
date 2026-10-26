import {describe,expect,it} from 'vitest';
import {planOf,partialPlan,stepKey} from '../../../apps/extension/src/shared/plan';
import {quickIdeas,mergeIdeas,ideasOf} from '../../../apps/extension/src/shared/ideas';

const ids=new Set(['e1','e2','e3']);
const known='Dana Lee dana@example.com Offsite at 410 Lakeview Drive on Friday';

describe('what Tab may do on a page',()=>{
 it('keeps steps on elements that are on the page, text included',()=>{
  const plan=planOf(JSON.stringify({label:'Fill in and send',confidence:0.8,steps:[{do:'type',id:'e1',text:'See you Friday at 410 Lakeview Drive'},{do:'click',id:'e2'}],more:true}),ids,known);
  expect(plan).toMatchObject({label:'Fill in and send',confidence:0.8,more:true});
  expect(plan!.steps).toEqual([{do:'type',id:'e1',text:'See you Friday at 410 Lakeview Drive'},{do:'click',id:'e2'}]);
 });
 it('stops at the first step on something that is not there, or that types a fact nobody gave',()=>{
  expect(planOf(JSON.stringify({confidence:0.9,steps:[{do:'click',id:'e1'},{do:'click',id:'e9'},{do:'click',id:'e2'}]}),ids,known)!.steps).toHaveLength(1);
  expect(planOf(JSON.stringify({confidence:0.9,steps:[{do:'type',id:'e1',text:'call me at 555-0199'}]}),ids,known)).toBeNull();
  expect(planOf(JSON.stringify({confidence:0.9,steps:[{do:'type',id:'e1',text:'Mail sam@other.example'}]}),ids,known)).toBeNull();
 });
 it('takes only web pages and plain keys, and nothing from a reply that is not JSON',()=>{
  expect(planOf(JSON.stringify({confidence:1,steps:[{do:'open',url:'javascript:alert(1)'}]}),ids,known)).toBeNull();
  expect(planOf(JSON.stringify({confidence:1,steps:[{do:'key',id:'e1',combo:'Control+Enter'}]}),ids,known)!.steps[0]).toEqual({do:'key',id:'e1',combo:'Control+Enter'});
  expect(planOf(JSON.stringify({confidence:1,steps:[{do:'key',id:'e1',combo:'rm -rf'}]}),ids,known)).toBeNull();
  expect(planOf('no idea',ids,known)).toBeNull();
  expect(planOf('{"steps":[]}',ids,known)).toBeNull();
 });
});

describe('what Ctrl+K offers as it opens',()=>{
 it('reads dates, addresses and other languages in the selection',()=>{
  const ideas=quickIdeas({selection:'Offsite: Friday, November 6 at 10 AM, 410 Lakeview Drive',inField:false,before:''}).map(i=>i.text);
  expect(ideas).toEqual(expect.arrayContaining(['Add this to my calendar','Show this on a map']));
  expect(quickIdeas({selection:'会议改到周五下午三点，请大家准时参加。',inField:true,before:''}).map(i=>i.text)).toContain('Translate this into English');
 });
 it('offers to draft a reply in an empty field under a conversation, and to fix a draft',()=>{
  expect(quickIdeas({selection:'',inField:true,before:'',thread:'Dana: are you coming?'})[0]).toEqual({text:'Draft a reply',kind:'edit'});
  expect(quickIdeas({selection:'teh meeting is tmrw',inField:true,before:''})[0].kind).toBe('edit');
 });
 it('puts the model\'s ideas first, without repeats, four at most',()=>{
  const merged=mergeIdeas(ideasOf('[{"text":"RSVP yes","kind":"page"},{"text":"Add this to my calendar!","kind":"act"},{"text":"bad","kind":"nope"}]'),[{text:'Add this to my calendar',kind:'act'},{text:'Explain this',kind:'answer'},{text:'Summarize',kind:'answer'},{text:'Translate',kind:'edit'}]);
  expect(merged.map(i=>i.text)).toEqual(['RSVP yes','Add this to my calendar!','Explain this','Summarize']);
 });
});

it('a plan still being written offers only its complete steps, and only once it has said how sure it is',()=>{
 const ids=new Set(['e1','e2']),known='offsite';
 const full=JSON.stringify({confidence:0.9,label:'Search',steps:[{do:'type',id:'e1',text:'offsite'},{do:'key',id:'e1',combo:'Enter'}]});
 expect(partialPlan(full.slice(0,full.indexOf('"steps"')),ids,known)).toBeNull();
 expect(partialPlan(full.slice(0,full.indexOf('{"do":"type"')+20),ids,known)).toBeNull();
 const early=partialPlan(full.slice(0,full.indexOf('{"do":"key"')+8),ids,known)!;
 expect(early.steps).toEqual([{do:'type',id:'e1',text:'offsite'}]);expect(early.confidence).toBe(0.9);expect(early.more).toBeUndefined();
 expect(stepKey(early.steps[0])).toBe('type:e1:offsite');
 // A one-step plan shows the moment its step closes, before the reply ends; a brace inside typed text is not a close.
 const one=JSON.stringify({confidence:0.8,label:'Send',steps:[{do:'click',id:'e2'}],more:false});
 expect(partialPlan(one.slice(0,one.indexOf('}')+1),ids,known)!.steps).toEqual([{do:'click',id:'e2'}]);
 const braced=JSON.stringify({confidence:0.8,label:'Type',steps:[{do:'type',id:'e1',text:'a } offsite'}]});
 expect(partialPlan(braced.slice(0,braced.indexOf('a }')+3),ids,known)).toBeNull();
});
