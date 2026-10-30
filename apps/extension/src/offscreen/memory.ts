import {MemoryIndex,docsFrom,mediaDocs,quantize,type Doc,type Found} from '../shared/memory-index';
import {recent,allVectors,putVectors,type Media} from '../background/db';
import {forQuery,forDoc,EMBED_BATCH} from '../shared/embedding';
import {rest,power} from './power';
/** Memory search, held in the offscreen document (it lives longer than the worker): everything remembered is loaded and
 * opened once, then kept current as memory changes; what has no embedding yet is embedded in small batches with pauses
 * between them, so the computer never feels it; a question is answered by keywords and meaning together. */
const worker=new Worker(chrome.runtime.getURL('embed.js'),{type:'module'});
let next=1;const waiting=new Map<number,{resolve:(v:number[][])=>void;reject:(e:Error)=>void}>();
worker.onmessage=(event:MessageEvent<{id:number;vectors?:number[][];error?:string}>)=>{const w=waiting.get(event.data.id);if(!w)return;waiting.delete(event.data.id);event.data.error?w.reject(new Error(event.data.error)):w.resolve(event.data.vectors!);};
let modelReady=false;
/** Texts as vectors. A request that has no answer in a minute (the model stuck, the worker gone) fails, so nothing that
 * waits on it (filling memory in, a search) waits for good. */
export function embed(texts:string[]):Promise<Int8Array[]>{
 const id=next++;
 return new Promise<number[][]>((resolve,reject)=>{
  const late=setTimeout(()=>{waiting.delete(id);reject(new Error('Embedding took over a minute.'));},60_000);
  waiting.set(id,{resolve:v=>{clearTimeout(late);resolve(v);},reject:e=>{clearTimeout(late);reject(e);}});worker.postMessage({id,texts});
 }).then(v=>v.map(quantize));
}

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
/** New memory since the index was built (pages read, writing, a meeting still going) joins it. A question asked while it
 * joins waits for it (a moment): what was just on screen is what the next question is often about. */
let refreshing:Promise<void>|undefined;
export function refresh(){
 // One after another: a refresh asked while one runs joins what came in meanwhile once it is done.
 const run=(refreshing??Promise.resolve()).then(joinNew),mine:Promise<void>=refreshing=run.catch(()=>{}).finally(()=>{if(refreshing===mine)refreshing=undefined;});
 return run;
}
async function joinNew(){
 if(!index)return;const since=loadedAt-60_000;loadedAt=Date.now();
 const [passages,writing,notes,media]=await Promise.all([recent('passages',20_000,since),recent('writing',5_000,since),recent('notes',5_000,since),recent('media',200,Date.now()-2*86_400_000)]);
 index.add(docsFrom({passages,writing,notes,media:[]}));
 // A meeting's passages grow as it goes: its documents are replaced.
 for(const m of media)for(const doc of mediaDocs(m))index.replace(doc);
 void fillVectors();
}
/** A meeting or video being listened to, searchable as it is said ("what did she just say?"). */
export async function upsertMedia(m:Media){
 lastActive=Date.now();if(!index)return;
 for(const doc of mediaDocs(m))index.replace(doc);
 void fillVectors();
}
export function reset(){index=undefined;loading=undefined;}
/** Embeds what has no vector yet, a few at a time, newest first, resting between batches (longer on battery, and not at
 * all on a low one: keywords find it meanwhile). stage: what it is doing now, for the debug page. */
let stage='idle';
function fillVectors(){
 if(backfill)return backfill;
 const run=(async()=>{
  try{
   for(let missing=index?.missingVectors(EMBED_BATCH)??[];missing.length;missing=index?.missingVectors(EMBED_BATCH)??[]){
    stage='embedding';const vectors=await embed(missing.map(forDoc));
    missing.forEach((d,i)=>index?.setVector(d.id,vectors[i]));
    stage='saving';await putVectors(missing.map((d,i)=>[d.id,vectors[i]]));
    stage='resting';await rest(250);
   }
  }catch(error){paused=String((error as Error)?.message??error);console.warn('Embedding paused:',error);}
 })();
 // Cleared once it is over, never before it is kept: with nothing to embed the run ends at once, and a `finally` inside
 // it cleared the slot before the run was put in it, so the slot held a finished run for good and nothing was embedded
 // again until the browser restarted.
 backfill=run;void run.then(()=>{if(backfill===run){backfill=undefined;stage='idle';}});
 return run;
}
export async function search(query:string,options:{k?:number;since?:number;kinds?:Doc['kind'][];sites?:string[]}={}):Promise<Found[]>{
 lastActive=Date.now();const built=await load();
 if(refreshing)await Promise.race([refreshing,new Promise(r=>setTimeout(r,400))]);
 // By meaning when the model is ready (a few milliseconds); while it is still loading (the first question after Chrome
 // starts), by words at once, and the model keeps loading for the next question. A search never waits on the model.
 const vector=await Promise.race([embed([forQuery(query)]).then(v=>v[0]).catch(()=>undefined),new Promise<undefined>(r=>setTimeout(()=>r(undefined),modelReady?2000:250))]);
 if(vector)modelReady=true;
 return built.find(query,{...options,query:vector});
}
/** Loads memory and the embedding model ahead of the first question (the side panel opening is a good moment). */
export async function warm(){lastActive=Date.now();await load();await embed([forQuery('warm')]).catch(()=>{});return{ok:true};}
/** Why embedding last stopped, if it failed (keywords find what it missed meanwhile). */
let paused:string|undefined;
export async function stats(){const built=await load();return{docs:built.size,vectors:built.vectors.size,embedding:backfill?'running':'idle',stage,power:power(),paused};}
