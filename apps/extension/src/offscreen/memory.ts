import {MemoryIndex,docsFrom,mediaDocs,quantize,type Doc,type Found} from '../shared/memory-index';
import {recent,allVectors,putVectors} from '../background/db';
import {forQuery,forDoc} from '../shared/embedding';
/** Memory search, held in the offscreen document (it lives longer than the worker): everything remembered is loaded and
 * opened once, then kept current as memory changes; what has no embedding yet is embedded in small batches with pauses
 * between them, so the computer never feels it; a question is answered by keywords and meaning together. */
const worker=new Worker(chrome.runtime.getURL('embed.js'),{type:'module'});
let next=1;const waiting=new Map<number,{resolve:(v:number[][])=>void;reject:(e:Error)=>void}>();
worker.onmessage=(event:MessageEvent<{id:number;vectors?:number[][];error?:string}>)=>{const w=waiting.get(event.data.id);if(!w)return;waiting.delete(event.data.id);event.data.error?w.reject(new Error(event.data.error)):w.resolve(event.data.vectors!);};
export function embed(texts:string[]):Promise<Int8Array[]>{const id=next++;return new Promise<number[][]>((resolve,reject)=>{waiting.set(id,{resolve,reject});worker.postMessage({id,texts});}).then(v=>v.map(quantize));}

let index:MemoryIndex|undefined,loading:Promise<MemoryIndex>|undefined,loadedAt=0,backfill:Promise<void>|undefined;
export let lastActive=Date.now();
async function load():Promise<MemoryIndex>{
 if(index)return index;
 return loading??=(async()=>{
  const started=Date.now(),built=new MemoryIndex();
  const [passages,writing,notes,media,vectors]=await Promise.all([recent('passages',200_000),recent('writing',50_000),recent('notes',50_000),recent('media',5_000),allVectors()]);
  built.add(docsFrom({passages,writing,notes,media}));
  for(const [id,v] of vectors)if(built.docs.has(id))built.setVector(id,v);
  index=built;loadedAt=started;loading=undefined;void fillVectors();
  return built;
 })();
}
/** New memory since the index was built (pages read, writing, a meeting still going) joins it. */
export async function refresh(){
 if(!index)return;const since=loadedAt-60_000;loadedAt=Date.now();
 const [passages,writing,notes,media]=await Promise.all([recent('passages',20_000,since),recent('writing',5_000,since),recent('notes',5_000,since),recent('media',200,Date.now()-2*86_400_000)]);
 index.add(docsFrom({passages,writing,notes,media:[]}));
 // A meeting's passages grow as it goes: its documents are replaced.
 for(const m of media)for(const doc of mediaDocs(m))index.replace(doc);
 void fillVectors();
}
export function reset(){index=undefined;loading=undefined;}
/** Embeds what has no vector yet, sixteen at a time, resting between batches. */
function fillVectors(){
 return backfill??=(async()=>{
  try{
   for(let missing=index?.missingVectors(16)??[];missing.length;missing=index?.missingVectors(16)??[]){
    const vectors=await embed(missing.map(forDoc));
    missing.forEach((d,i)=>index?.setVector(d.id,vectors[i]));
    await putVectors(missing.map((d,i)=>[d.id,vectors[i]]));
    await new Promise(r=>setTimeout(r,250));
   }
  }catch(error){console.warn('Embedding paused:',error);}
  finally{backfill=undefined;}
 })();
}
export async function search(query:string,options:{k?:number;since?:number;kinds?:Doc['kind'][];sites?:string[]}={}):Promise<Found[]>{
 lastActive=Date.now();const built=await load();
 const vector=await embed([forQuery(query)]).then(v=>v[0]).catch(()=>undefined);
 return built.find(query,{...options,query:vector});
}
export async function stats(){const built=await load();return{docs:built.size,vectors:built.vectors.size};}
