import {it,expect,describe} from 'vitest';
import {Learner,pageKindOf,clickKey,type Step} from '../../../apps/extension/src/shared/learn';

const day=86_400_000,base=new Date('2026-10-05T09:00:00').getTime();
const click=(pageKind:string,name:string,at:number):Step=>({kind:'click',pageKind,key:clickKey('button',name),label:name,target:{role:'button',name},at});
const visit=(url:string,at:number):Step=>({kind:'navigate',pageKind:pageKindOf(url),key:'nav:'+pageKindOf(url),label:url,url,at});

describe('learning the next step',()=>{
 it('names a kind of page the same for every item',()=>{
  expect(pageKindOf('https://supabase.com/dashboard/project/qewguvfkkwvdoqptiljd/logs/edge-functions')).toBe('supabase.com/dashboard/project/*/logs/edge-functions');
  expect(pageKindOf('https://github.com/acme/app/pull/455?tab=files')).toBe('github.com/acme/app/pull/*');
  expect(pageKindOf('https://mail.google.com/mail/u/0/#inbox/FMfcgzQXJWDsKhHvvLxQz')).toBe('mail.google.com/mail/u/*#inbox/*');
  expect(pageKindOf('https://docs.example.com/guide#installation')).toBe('docs.example.com/guide');
  expect(pageKindOf('https://www.example.com/docs/getting-started/')).toBe('example.com/docs/getting-started');
 });
 it('offers a habit once it is strong, with no model needed',()=>{
  const learner=new Learner(),page='supabase.com/dashboard/project/*';
  for(let i=0;i<6;i++){const at=base+i*day;learner.observe(undefined,click(page,'Edge Functions',at));learner.observe(click(page,'Edge Functions',at),click(page,'Logs',at+5000));}
  const [best]=learner.candidates({pageKind:page,prev:click(page,'Edge Functions',base+7*day),now:base+7*day});
  expect(best.step.label).toBe('Logs');expect(best.strong).toBe(true);expect(best.count).toBeGreaterThanOrEqual(5);
 });
 it('is not sure when the next step varies, and needs a few repeats first',()=>{
  const learner=new Learner(),page='app.example.com/inbox';
  for(let i=0;i<4;i++)learner.observe(click(page,'Open',base+i*day),click(page,'Archive',base+i*day+1000));
  for(let i=0;i<3;i++)learner.observe(click(page,'Open',base+(i+5)*day),click(page,'Reply',base+(i+5)*day+1000));
  const found=learner.candidates({pageKind:page,prev:click(page,'Open',base+9*day),now:base+9*day});
  expect(found.every(c=>!c.strong)).toBe(true);
  const fresh=new Learner();fresh.observe(undefined,click(page,'Open',base));fresh.observe(undefined,click(page,'Open',base+day));
  expect(fresh.candidates({pageKind:page,now:base+2*day})).toHaveLength(0);
 });
 it('lets old habits fade',()=>{
  const learner=new Learner(),page='news.example.com';
  for(let i=0;i<8;i++)learner.observe(undefined,click(page,'Old section',base+i*day));
  for(let i=0;i<6;i++)learner.observe(undefined,click(page,'New section',base+(120+i)*day));
  const [best]=learner.candidates({pageKind:page,now:base+127*day});expect(best.step.label).toBe('New section');
 });
 it('survives being saved and read back',()=>{
  const learner=new Learner();for(let i=0;i<5;i++)learner.observe(visit('https://a.com/x',base+i*day),visit('https://b.com/report/123',base+i*day+60_000));
  const again=Learner.from(JSON.parse(JSON.stringify(learner)));
  expect(again.candidates({pageKind:'a.com/x',prev:visit('https://a.com/x',base+6*day),now:base+6*day})[0].step.url).toBe('https://b.com/report/123');
 });
 it('measures itself on the user\'s own steps: right when it shows',()=>{
  const page='supabase.com/dashboard/project/*',steps:Step[]=[];
  for(let i=0;i<20;i++){const at=base+i*day;steps.push(click(page,'Edge Functions',at),click(page,'Logs',at+5000),click(page,'Refresh',at+10_000));}
  const m=Learner.meter(steps);expect(m.shown).toBeGreaterThan(20);expect(m.precision).toBeGreaterThan(0.9);
 });
});
