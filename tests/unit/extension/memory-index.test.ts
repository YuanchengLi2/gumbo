import {it,expect,describe} from 'vitest';
import {MemoryIndex,quantize} from '../../../apps/extension/src/shared/memory-index';

// Unit vectors along one axis each: a memory's closeness to a reading is plain to see.
const axis=(i:number)=>{const v=new Array(384).fill(0);v[i]=1;return quantize(v);};
const doc=(id:string,title:string,text:string)=>({id,kind:'page' as const,title,text,at:0});

describe('memory search',()=>{
 it('a question read two ways finds what is close to either reading, as close as its closest',()=>{
  const index=new MemoryIndex();
  index.add([doc('groq','Why Groq is fast','The first token arrives in about 150 ms.'),doc('lunch','Lunch','Lunch with Sam at Tartine on Friday.')]);
  index.setVector('groq',axis(0));index.setVector('lunch',axis(1));
  // The instruction alone is about Groq; with the selection it is about lunch.
  const found=index.find('where did I read about latency',{k:4,query:[axis(0),axis(1)]});
  expect(found.find(f=>f.id==='groq')?.cos).toBeCloseTo(1,2);
  expect(found.find(f=>f.id==='lunch')?.cos).toBeCloseTo(1,2);
  // One reading: only what is close to it.
  expect(index.find('x',{k:4,query:axis(0)}).find(f=>f.id==='lunch')?.cos).toBeUndefined();
 });
 it('counts how many of the question\'s words a match holds, one more for a word in its title',()=>{
  const index=new MemoryIndex();
  index.add([doc('groq','Why Groq is fast','The first token arrives in about 150 ms.')]);
  expect(index.find('groq first token')[0].words).toBe(4);
  expect(index.find('first token')[0].words).toBe(2);
 });
});
