import {it,expect,describe} from 'vitest';
import {choose,moved,unit,cosine,threshold,histogram,joinBar} from '../../../apps/extension/src/shared/projects-core';
import {applyOps,emptyProfile,recurringFacts,styleStats,routinesOf} from '../../../apps/extension/src/shared/profile-core';
import {categoryOf} from '../../../apps/extension/src/shared/page-kind';

const axis=(i:number,noise=0)=>unit(Array.from({length:8},(_,j)=>j===i?1:noise*((j*7+i*3)%5)/5));

describe('projects',()=>{
 const trip={id:'trip',centroid:axis(0),sites:['airbnb.com'],visits:4},bug={id:'bug',centroid:axis(1),sites:['github.com'],visits:6};
 const options={join:0.8,chainBonus:0.15,siteBonus:0.1,projects:[trip,bug]};
 it('joins the project closest in meaning',()=>{
  expect(choose({...options,gist:axis(0,0.1),site:'kayak.com'}).id).toBe('trip');
  expect(choose({...options,gist:axis(1,0.1),site:'stackoverflow.com'}).id).toBe('bug');
 });
 it('starts a new thread when nothing is close',()=>{expect(choose({...options,gist:axis(4),site:'news.com'}).id).toBeUndefined();});
 it('is helped over the line by the chain it came along and the site',()=>{
  const between=unit(axis(0).map((x,i)=>x+axis(5)[i]*0.9));
  expect(cosine(between,axis(0))).toBeLessThan(0.8);
  expect(choose({...options,gist:between,site:'news.com'}).id).toBeUndefined();
  expect(choose({...options,gist:between,site:'airbnb.com',chain:'trip'}).id).toBe('trip');
 });
 it('moves its centre toward each new visit and keeps it unit length',()=>{
  const c=moved(axis(0),axis(1),1);expect(cosine(c,axis(0))).toBeCloseTo(cosine(c,axis(1)),5);expect(cosine(c,c)).toBeCloseTo(1,5);
 });
 it('learns the threshold that best tells the same work from different work',()=>{
  const same=[0.86,0.9,0.84,0.92,0.88,0.79,0.95],other=[0.62,0.7,0.66,0.74,0.58,0.81,0.69];
  const t=threshold(same,other);expect(t).toBeGreaterThan(0.74);expect(t).toBeLessThanOrEqual(0.84);
  expect(histogram([0.05,0.51,0.99]).reduce((a,b)=>a+b,0)).toBe(3);
  // Never a bar that lets in more than a tenth of unrelated pairs, however loosely the two sets separate.
  const loose=Array.from({length:50},(_,i)=>0.5+i*0.004);
  expect(joinBar([0.6,0.62,0.65,0.7,0.9],loose)).toBeGreaterThan(loose[44]);
 });
});

describe('the profile',()=>{
 it('merges changes one at a time and never duplicates',()=>{
  let p=applyOps(emptyProfile(),[{op:'set',path:'who',value:'A product designer at Acme'},{op:'add',path:'people',value:'Priya (teammate)'},{op:'add',path:'people',value:'priya (teammate)'},{op:'set',path:'style.email.tone',value:'warm, brief'},{op:'set',path:'nonsense',value:'x'} as any]);
  expect(p.who).toBe('A product designer at Acme');expect(p.people).toEqual(['Priya (teammate)']);expect(p.style.email.tone).toBe('warm, brief');
  p=applyOps(p,[{op:'remove',path:'people',value:'PRIYA (teammate)'}]);expect(p.people).toEqual([]);
 });
 it('learns the facts they type again and again',()=>{
  const w=(text:string,i:number)=>({text,at:i});
  const facts=recurringFacts([w('Ship it to 221 Baker Street, London please',1),w('My address is 221 Baker Street, London',2),w('Use 221 Baker Street, London',3),w('see https://cal.com/dana/30min',4),w('book here https://cal.com/dana/30min',5),w('https://cal.com/dana/30min works',6),w('one-off https://example.com',7)]);
  expect(facts.map(f=>f.kind)).toEqual(expect.arrayContaining(['address','link']));
  expect(facts.find(f=>f.kind==='link')!.text).toBe('https://cal.com/dana/30min');
  expect(facts.some(f=>f.text.includes('example.com'))).toBe(false);
 });
 it('learns how they open and close each kind of message',()=>{
  const mails=['Hi Sam,\nThe deck is attached.\nBest,\nDana','Hi Priya,\nLet me know what you think.\nBest,\nDana','Hi team,\nNotes from today below.\nBest,\nDana'].map(text=>({text,intent:'email',site:'mail.google.com'}));
  const s=styleStats(mails).email;expect(s.signOffs[0]).toBe('Best, / Dana');expect(s.samples).toBe(3);
 });
 it('finds the sites they open first at a time of day',()=>{
  const visits=[1,2,5,6,7].flatMap(d=>[{site:'mail.google.com',in:new Date(2026,9,d,9,0).getTime()},{site:'github.com',in:new Date(2026,9,d,9,10).getTime()}]);
  expect(routinesOf(visits)[0]).toBe('Weekday mornings: opens mail.google.com, then github.com');
 });
});

describe('kinds of page',()=>{
 it('reads what a page is from its address and a few signs',()=>{
  expect(categoryOf('https://mail.google.com/mail/u/0/#inbox')).toBe('inbox');
  expect(categoryOf('https://mail.google.com/mail/u/0/#inbox/FMfcgzQXJWDsKhHvvLxQzabc')).toBe('thread');
  expect(categoryOf('https://www.google.com/search?q=tide+pools')).toBe('results');
  expect(categoryOf('https://www.youtube.com/watch?v=abc')).toBe('video');
  expect(categoryOf('https://docs.google.com/document/d/abc/edit')).toBe('doc');
  expect(categoryOf('https://shop.example.com/checkout')).toBe('checkout');
  expect(categoryOf('https://example.com/apply',undefined,{fields:6})).toBe('form');
  expect(categoryOf('https://blog.example.com/post/tides',undefined,{textLength:9000})).toBe('article');
 });
});
