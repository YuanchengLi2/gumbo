import {describe,expect,it} from 'vitest';
import {wordsShown,moveBeatsWords,wordsYield,yieldWords,offerWords} from '../../../apps/extension/src/content/bus';
import {partialPlan,planOf} from '../../../apps/extension/src/shared/plan';

describe('Tab offers one thing at a time, the one most likely right',()=>{
 it('a move takes the place of ghost words only when it is sure and much surer than they are',()=>{
  wordsShown(true,0.5);
  expect(moveBeatsWords(0.85)).toBe(true);
  // Sure, but not much surer than the words.
  wordsShown(true,0.8);expect(moveBeatsWords(0.85)).toBe(false);
  // Much surer than the words, but not sure.
  wordsShown(true,0.3);expect(moveBeatsWords(0.6)).toBe(false);
  // Words the model gave no confidence for count as fairly sure.
  wordsShown(true);expect(moveBeatsWords(0.8)).toBe(false);expect(moveBeatsWords(0.9)).toBe(true);
  wordsShown(false);expect(moveBeatsWords(0.95)).toBe(false);
 });
 it('the ghost is asked to give way, and a move that types into the field is offered to it as words',()=>{
  let yielded=0;const offered:string[]=[];
  wordsYield(()=>{yielded++;},(_el,text)=>{offered.push(text);return true;});
  yieldWords();expect(yielded).toBe(1);
  expect(offerWords({} as Element,'NL-58213-77',0.85)).toBe(true);expect(offered).toEqual(['NL-58213-77']);
 });
});

describe('a move that types into the field, as the model writes it',()=>{
 const ids=new Set(['e1','e2']),known='Send NL-58213-77';
 it('reads as one plan while it streams and when it is whole',()=>{
  const input={confidence:0.85,label:'Type the order number',steps:[{do:'type',id:'e2',text:'NL-58213-77'}],why:'support asked for it'};
  expect(planOf(JSON.stringify(input),ids,known)).toMatchObject({confidence:0.85,steps:[{do:'type',id:'e2',text:'NL-58213-77'}]});
  // The move shows as soon as its first step closes.
  const streamed='{"confidence":0.85,"label":"Type the order number","steps":[{"do":"type","id":"e2","text":"NL-58213-77"}';
  expect(partialPlan(streamed,ids,known)?.steps).toHaveLength(1);
 });
});
