import {it,expect} from 'vitest';
import {resolve} from 'node:path';
import {existsSync} from 'node:fs';
import {pipeline,env} from '@huggingface/transformers';
import {MemoryIndex,quantize} from '../../apps/extension/src/shared/memory-index';
import {memory,questions} from '../../apps/extension/test/fixtures/memory';

// Recall, measured: every question, asked in other words than the ones stored, must bring back the item that answers it
// in the top five, with the same embedding model the extension ships (bge-small, run here on this computer).
const models=resolve(import.meta.dirname,'../../apps/extension/public/models');
const model=process.env.GUMBO_EMBED_MODEL??'Xenova/bge-small-en-v1.5';
// bge reads a question with an instruction before it and pools on its first token; MiniLM averages.
const bge=model.includes('bge'),ask=(q:string)=>bge?`Represent this sentence for searching relevant passages: ${q}`:q;
it.runIf(existsSync(resolve(models,model,'onnx/model_quantized.onnx')))('remembers: the right item is in the top five for every question',async()=>{
 env.allowRemoteModels=false;env.localModelPath=models+'/';
 const embed=await pipeline('feature-extraction',model,{dtype:'q8'});
 const vectors=async(texts:string[])=>((await embed(texts,{pooling:bge?'cls':'mean',normalize:true})).tolist() as number[][]).map(quantize);
 const index=new MemoryIndex();index.add(memory);
 const docVectors=await vectors(memory.map(d=>`${d.title}\n${d.text}`));memory.forEach((d,i)=>index.setVector(d.id,docVectors[i]));
 const queryVectors=await vectors(questions.map(q=>ask(q.q)));
 const misses:string[]=[];let first=0,keywordOnly=0;
 questions.forEach((question,i)=>{
  const found=index.find(question.q,{k:5,query:queryVectors[i]}).map(f=>f.id);
  if(!found.includes(question.answer))misses.push(`${question.q} → ${found.join(',')}`);
  if(found[0]===question.answer)first++;
  if(index.find(question.q,{k:5}).some(f=>f.id===question.answer))keywordOnly++;
 });
 console.log(`${model} recall: ${questions.length-misses.length}/${questions.length} in the top five, ${first} first; keywords alone ${keywordOnly}/${questions.length}`);
 expect(misses).toEqual([]);
},120_000);
