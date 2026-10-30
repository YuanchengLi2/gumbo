/** How close in meaning is close enough, measured rather than guessed. Memory's own search (shared/memory-index.ts) and
 * its own test of what bears on the moment (shared/rank.ts bearing) run over the recall set (test/fixtures/memory.ts:
 * questions with the memory that answers each, and distractors that share its words) and over Tab's moments
 * (test/fixtures/memory-moments.ts), with the model the extension ships. Each surface asks as it does in the extension:
 * Ctrl+K and the sidebar with a page's text in the question's words and meaning judged by its focus; Tab with everything
 * about the field. For each bar it prints how many answers are kept and how many other memories come with them. Runs on
 * this computer, costs nothing.
 *   npx tsx apps/extension/scripts/relevance.ts [--bars=0.45,0.5,0.55,0.58,0.6]
 * Oct 30: 0.45 let in about half of all unrelated memory (unrelated texts score about 0.45 with bge-small); 0.58 keeps
 * nearly every answer and lets in a few in a hundred. */
import {resolve} from 'node:path';
import {pipeline,env} from '@huggingface/transformers';
import {MemoryIndex,quantize,type Doc} from '../src/shared/memory-index';
import {EMBEDDING,forDoc,forQuery} from '../src/shared/embedding';
import {bearing} from '../src/shared/rank';
import {defaults} from '../src/shared/memory-config';
import {memory,questions} from '../test/fixtures/memory';
import {memoryMoments} from '../test/fixtures/memory-moments';
import {fieldQuery,writingQuery} from '../src/background/memory-context';

const bars=(process.argv.find(a=>a.startsWith('--bars='))?.slice(7)??'0.45,0.5,0.55,0.58,0.6').split(',').map(Number);
/** How strong a word match must be, as a share of the question's best (above 1: words never count on their own). */
const words=(process.argv.find(a=>a.startsWith('--words='))?.slice(8)??'0.6').split(',').map(Number);
/** How near the moment's closest match in meaning a memory must be (none: any above the bar). */
const nears=(process.argv.find(a=>a.startsWith('--near='))?.slice(7)??'none,0.1,0.08,0.06,0.04').split(',').map(x=>x==='none'?undefined:Number(x));
env.allowRemoteModels=false;env.localModelPath=resolve(import.meta.dirname,'../public/models')+'/';
const embed=await pipeline('feature-extraction',EMBEDDING.model,{dtype:'q8'});
const vectors=async(texts:string[])=>((await embed(texts,{pooling:EMBEDDING.pooling,normalize:true})).tolist() as number[][]).map(quantize);
const indexOf=async(docs:Doc[])=>{const index=new MemoryIndex();index.add(docs);(await vectors(docs.map(forDoc))).forEach((v,i)=>index.setVector(docs[i].id,v));return index;};
type Case={name:string;index:MemoryIndex;
 /** A focused question: the extension keeps only what is near its closest match (memory/context.ts). */focused:boolean;asks:{words:string;focus:string;answers:string[];except?:string}[]};

// Ctrl+K and the sidebar: the question with the page it is asked on (another memory's text, which the extension leaves
// out as the page in front: except), meaning judged by the question alone.
const recall:Case={name:'Ctrl+K and the sidebar (a question asked on a page)',focused:true,index:await indexOf(memory),asks:questions.map((q,i)=>{
 const page=memory[(i*7+3)%memory.length],on=page.id!==q.answer;
 return{words:on?`${q.q}\nNotes Subject Comment\n${page.title}\n${page.text}`:q.q,focus:q.q,answers:[q.answer],except:on?page.id:undefined};
})};
// Tab: everything about the field (its title, label, the message above, the sentence under way), the moment's own memory
// against the other moments' and the whole recall set.
const pool:Doc[]=[...memoryMoments.flatMap((m,i)=>m.memory.map((x,j)=>({id:`m${i}.${j}`,kind:'page' as const,title:x.title,text:x.text,at:Date.now()}))),...memory];
const tab:Case={name:'Tab (a field and what is being written)',focused:false,index:await indexOf(pool),asks:memoryMoments.map((m,i)=>{
 const q=fieldQuery({title:m.title,label:m.label,thread:m.thread,sentence:writingQuery(m.before)});
 return{words:q,focus:q,answers:m.memory.map((_,j)=>`m${i}.${j}`)};
})};

for(const c of [recall,tab]){
 const asked=await Promise.all(c.asks.map(async a=>({...a,vector:(await vectors([forQuery(a.focus)]))[0]})));
 console.log(`${c.name}, ${c.asks.length} moments:`);
 for(const nearBest of c.focused?nears:[undefined])for(const minBm25 of words)for(const minCos of bars){
  let kept=0,others=0,wanted=0;
  for(const a of asked){
   const found=c.index.find(a.words,{k:16,query:a.vector}).filter(f=>f.id!==a.except);
   const ok=found.filter(bearing(found,{...defaults.rank,minCos,minBm25,nearBest}));
   kept+=a.answers.filter(id=>ok.some(f=>f.id===id)).length;wanted+=a.answers.length;
   others+=ok.filter(f=>!a.answers.includes(f.id)).length;
  }
  const now=minCos===defaults.rank.minCos&&minBm25===defaults.rank.minBm25&&nearBest===(c.focused?defaults.rank.nearBest:undefined);
  console.log(`  meaning ${minCos.toFixed(2)}, words ${minBm25>1?'off':minBm25.toFixed(2)} of the best, near ${nearBest===undefined?'any':nearBest.toFixed(2)}${now?' (now)':''}: keeps ${kept}/${wanted} answers, with ${(others/asked.length).toFixed(1)} other memories a moment`);
 }
}
