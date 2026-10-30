import {offscreen,notifyOffscreen} from './offscreen';
import {MemoryIndex,docsFrom,type Found,type Doc} from '../shared/memory-index';
import {recent} from './db';
/** Searching memory: in the offscreen document (keywords and meaning, src/offscreen/memory.ts); if that cannot run, by
 * keywords here, so a question is always answered from what is there. */
export type {Found};
let fallback:{index:MemoryIndex;at:number}|undefined;
/** How many times memory has changed since the worker started: a search kept for a moment (memory/context.ts) is asked
 * again once memory holds something newer, even when its question is the same. */
export let memoryGeneration=0;
export function memoryChanged(){fallback=undefined;memoryGeneration++;void notifyOffscreen('index.changed');}
export function memoryReset(){fallback=undefined;void notifyOffscreen('index.reset');}
/** focus: what meaning is judged by, when the question's words hold more than its heart (memory/context.ts). */
type Options={k?:number;since?:number;kinds?:Doc['kind'][];sites?:string[];focus?:string};
export async function searchMemory(query:string,options:Options={}):Promise<Found[]>{return (await searchWhole(query,options)).found;}
/** A search, and whether it was whole (by meaning as well as words, over everything: offscreen/memory.ts searchWhole). By
 * words here, when the offscreen document cannot answer, it never is. */
export async function searchWhole(query:string,options:Options={}):Promise<{found:Found[];whole:boolean}>{
 if(!query.trim())return{found:[],whole:true};
 try{return await offscreen<{found:Found[];whole:boolean}>({type:'search.whole',query,options});}
 catch{
  try{
   if(!fallback){const [passages,writing,notes,media]=await Promise.all([recent('passages',20_000),recent('writing',5_000),recent('notes',5_000),recent('media',500)]);const index=new MemoryIndex();index.add(docsFrom({passages,writing,notes,media}));fallback={index,at:Date.now()};}
   return{found:fallback.index.find(query,options),whole:false};
  }catch{return{found:[],whole:false};}
 }
}
