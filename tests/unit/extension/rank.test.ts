import {it,expect,describe} from 'vitest';
import {rank,wordsOf,bearing,type Candidate} from '../../../apps/extension/src/shared/rank';
import {defaults} from '../../../apps/extension/src/shared/memory-config';

const now=new Date('2026-10-27T15:00:00').getTime(),hour=3_600_000,day=24*hour;
const m=(query:string,extra:{project?:string;site?:string}={})=>({now,words:wordsOf(query),...extra});
const past=(id:string,text:string,o:Partial<Candidate>={}):Candidate=>({id,layer:'past',kind:'page',title:id,text,at:now-5*day,...o});

describe('ranking what a moment is given',()=>{
 it('puts the passage about the moment above distractors that share words',()=>{
  const query='Reply to Sam about moving the dentist appointment';
  const candidates=[
   past('dentist-email','Dr. Patel’s office: your appointment is Thursday at 3pm; call to reschedule.',{cos:0.62,bm25:4.1,seenMs:40_000}),
   past('dentist-wiki','A dentist is a surgeon who specializes in dentistry.',{cos:0.48,bm25:5.2}),
   past('sam-lunch','Sam: lunch on Friday?',{cos:0.31,bm25:2.0,at:now-30*day}),
   past('moving-boxes','Moving boxes and tape, 20% off this week.',{cos:0.2,bm25:2.5}),
  ];
  expect(rank(candidates,m(query),defaults.rank,4000)[0].id).toBe('dentist-email');
 });
 it('prefers this session’s chain and the same project when meaning is close',()=>{
  const c=[past('old','Flight options to Lisbon in May',{cos:0.55,bm25:3,at:now-20*day}),{...past('this-trip','Flight options to Lisbon in June',{cos:0.53,bm25:3}),layer:'session' as const,at:now-10*60_000,chain:true,project:'trip'}];
  expect(rank(c,m('Lisbon flights',{project:'trip'}),defaults.rank,4000)[0].id).toBe('this-trip');
 });
 it('says each thing once, and stays within the budget',()=>{
  const same='The quarterly report is due Friday and needs the revenue table from finance.';
  const c=[past('a',same,{cos:0.7,bm25:5}),past('b',same+' ',{cos:0.69,bm25:5}),past('c','Finance sends the revenue table on Thursdays.',{cos:0.5,bm25:3})];
  const out=rank(c,m('quarterly report revenue table'),defaults.rank,4000);
  expect(out.map(x=>x.id)).toEqual(['a','c']);
  expect(rank(c,m('quarterly report'),defaults.rank,150).length).toBe(1);
 });
 it('counts what was read longer, and what helped before',()=>{
  const c=[past('skimmed','Notes on the API rate limits',{cos:0.5,bm25:3}),past('read','Notes on the API rate limits and retries',{cos:0.5,bm25:3,seenMs:120_000,useful:2})];
  const [first]=rank(c,m('API rate limits'),defaults.rank,4000);expect(first.id).toBe('read');expect(first.parts.seen).toBeGreaterThan(0);
 });
});

describe('what bears on the moment (the relevance bar, set by scripts/relevance.ts)',()=>{
 // A field's question: the floor alone (nearBest is for focused questions, as memory/context.ts asks).
 const w={...defaults.rank,nearBest:undefined};
 it('keeps what is close in meaning and drops what is merely like it (unrelated texts score about 0.45)',()=>{
  const found=[{cos:0.72},{cos:0.56},{cos:0.48}];
  expect(found.map(bearing(found,w))).toEqual([true,true,false]);
 });
 it('for a focused question keeps only what is near its closest match',()=>{
  const found=[{cos:0.74},{cos:0.69},{cos:0.6}];
  expect(found.map(bearing(found,{...w,nearBest:defaults.rank.nearBest}))).toEqual([true,true,false]);
  // Nothing about it in memory: the closest is noise, and the floor keeps it out.
  const none=[{cos:0.52},{cos:0.5}];
  expect(none.map(bearing(none,{...w,nearBest:defaults.rank.nearBest}))).toEqual([false,false]);
 });
 it('keeps a strong word match whatever its meaning, and only a strong one',()=>{
  const found=[{cos:0.4,bm25:6},{cos:0.4,bm25:1.5},{cos:0.4,bm25:2.4}];
  expect(found.map(bearing(found,w))).toEqual([true,false,false]);
 });
 it('with no meaning yet (the model loading, just seen) judges by how many of the question\'s words it holds, whatever the size of memory',()=>{
  // One memory: BM25 is small however well it matches.
  const found=[{bm25:1.3,words:2},{bm25:0.9,words:1}];
  expect(found.map(bearing(found,w))).toEqual([true,false]);
 });
});
