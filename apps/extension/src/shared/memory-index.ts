import MiniSearch from 'minisearch';
import type {Passage,Writing,Note,Media} from '../background/db';
import {momentUrl} from './moment';
/** One index over everything remembered: the passages of pages read, the user's own writing, notes, and what was said in
 * meetings and videos (half a minute of speech per passage, pointing at its moment). A question is matched two ways
 * and the two rankings are fused (reciprocal rank fusion): by keywords (BM25, with prefix and fuzzy matches) and by
 * meaning (cosine similarity of sentence embeddings, made on this computer). Exact names and numbers come up through
 * the first; "that thing about latency" through the second. */
export type Doc={id:string;kind:'page'|'fact'|'writing'|'note'|'media';title:string;url?:string;text:string;at:number;site?:string;start?:number;
 /** The visit a passage was read on (or writing written on), and how long it was in view. */visit?:number;seenMs?:number;project?:string};
/** A match, with the two raw scores it got (cosine, and BM25 as MiniSearch gives it), for memory/context.ts to weigh
 * with what it knows of the moment. */
export type Found=Doc&{score:number;cos?:number;bm25?:number};
export const DIMENSIONS=384;
const STOP=new Set('a an the and or but if then so of to in on at by for with from as is are was were be been being it its this that these those i you he she we they me my your our their his her them us not no do does did done have has had will would can could should may might just also than too very into about over after before more most some any all each other such only own same what which who whom whose when where why how there here out up down off again further once am get got'.split(' '));

export function docsFrom({passages,writing,notes,media}:{passages:Passage[];writing:Writing[];notes:Note[];media:Media[]}):Doc[]{
 const docs:Doc[]=[];
 // A fact on a page is a small document of its own, under the page's title and time (“Total due: $482.00”).
 for(const p of passages)docs.push({id:'p'+p.id,kind:p.kind==='media'?'media':p.kind==='fact'?'fact':'page',title:p.title,url:p.url,text:p.text,at:p.at,site:p.site,visit:p.visit,seenMs:p.seenMs});
 for(const w of writing)docs.push({id:'w'+w.id,kind:'writing',title:`You wrote on ${w.site}${w.label?` (${w.label})`:''}`,url:w.url,text:w.text+(w.replyTo?`\n(in reply to ${w.replyTo})`:''),at:w.at,site:w.site,visit:w.visit,project:w.project});
 for(const n of notes)docs.push({id:'n'+n.id,kind:'note',title:n.title??'Your note',url:n.url,text:n.text,at:n.at});
 for(const m of media)docs.push(...mediaDocs(m));
 return docs;
}
/** A meeting or video as passages of about half a minute of speech by one speaker, each with its moment; and its notes. */
export function mediaDocs(m:Media):Doc[]{
 const out:Doc[]=[];let text='',start=0,speaker='',n=0;
 const flush=()=>{if(text.trim())out.push({id:`m${m.id}:${n++}`,kind:'media',title:`${m.title}${speaker?` — ${speaker}`:''}`,url:m.kind==='meeting'?m.url:momentUrl(m.url,start),text,at:m.startedAt+start*1000,site:m.site,start});text='';};
 for(const s of m.segments){if(text&&(s.start-start>30||s.speaker!==speaker))flush();if(!text){start=s.start;speaker=s.speaker;}text+=(text?' ':'')+s.text;}
 flush();
 if(m.notes)out.push({id:`mn${m.id}`,kind:'media',title:`Notes: ${m.title}`,url:m.url,text:m.notes,at:m.endedAt??m.startedAt,site:m.site});
 return out;
}
/** A unit-length embedding as 8-bit integers (a quarter of the size; cosine stays within a percent). */
export function quantize(vector:ArrayLike<number>):Int8Array{const out=new Int8Array(vector.length);for(let i=0;i<vector.length;i++)out[i]=Math.max(-127,Math.min(127,Math.round(vector[i]*127)));return out;}

export class MemoryIndex{
 // Words that say nothing about what is meant (the, for, about…) are left out of the keyword side, so they cannot
 // outrank a match in meaning; short words are matched exactly, longer ones also by prefix and with a typo or two.
 private search=new MiniSearch<Doc>({fields:['title','text'],storeFields:['id'],processTerm:term=>{const t=term.toLowerCase();return STOP.has(t)?null:t;},
  searchOptions:{boost:{title:2},prefix:term=>term.length>3,fuzzy:term=>term.length>4?0.15:0,combineWith:'OR',processTerm:term=>{const t=term.toLowerCase();return STOP.has(t)?null:t;}}});
 readonly docs=new Map<string,Doc>();
 readonly vectors=new Map<string,Int8Array>();
 get size(){return this.docs.size;}
 add(docs:Doc[]){const fresh=docs.filter(d=>!this.docs.has(d.id));for(const d of fresh)this.docs.set(d.id,d);this.search.addAll(fresh);return fresh;}
 replace(doc:Doc){if(this.docs.has(doc.id)){this.search.discard(doc.id);this.docs.delete(doc.id);}this.add([doc]);}
 remove(ids:string[]){for(const id of ids)if(this.docs.has(id)){this.search.discard(id);this.docs.delete(id);this.vectors.delete(id);}}
 setVector(id:string,vector:Int8Array){this.vectors.set(id,vector);}
 /** What has no embedding yet, newest first: what was just seen is found by meaning before the backlog of the past. */
 missingVectors(limit=Infinity){const out:Doc[]=[];for(const d of [...this.docs.values()].reverse()){if(!this.vectors.has(d.id))out.push(d);if(out.length>=limit)break;}return out;}
 /** The best matches for a question; `query` is its embedding when there is one. */
 find(text:string,{k=6,query,since,kinds,sites}:{k?:number;query?:Int8Array;since?:number;kinds?:Doc['kind'][];sites?:string[]}={}):Found[]{
  const allowed=(d:Doc)=>(!since||d.at>=since)&&(!kinds||kinds.includes(d.kind))&&(!sites||!!d.site&&sites.includes(d.site));
  const ranks=new Map<string,number>(),depth=Math.max(50,k*8),raw=new Map<string,{cos?:number;bm25?:number}>();
  if(text.trim())this.search.search(text).filter(hit=>allowed(this.docs.get(hit.id as string)!)).slice(0,depth).forEach((hit,i)=>{ranks.set(hit.id as string,(ranks.get(hit.id as string)??0)+1/(60+i));raw.set(hit.id as string,{bm25:hit.score});});
  if(query){
   const scored:[string,number][]=[];
   for(const [id,v] of this.vectors){const d=this.docs.get(id);if(!d||!allowed(d))continue;let dot=0;for(let i=0;i<v.length;i++)dot+=v[i]*query[i];scored.push([id,dot]);}
   scored.sort((a,b)=>b[1]-a[1]);
   // What is unrelated in meaning does not count (a paraphrase scores 0.2 to 0.5 with this model, noise below 0.1).
   scored.slice(0,depth).filter(([,dot])=>dot/(127*127)>0.1).forEach(([id,dot],i)=>{ranks.set(id,(ranks.get(id)??0)+1/(60+i));raw.set(id,{...raw.get(id),cos:dot/(127*127)});});
  }
  // A question about what the user themself said or wrote leans toward their own writing; one about what someone said,
  // toward meetings and videos.
  const own=/\b(i|did i|have i|my)\b[^?]*\b(write|wrote|written|say|said|tell|told|give|gave|reply|replied|answer|answered|send|sent|ask|asked|comment|commented|feedback)\b/i.test(text);
  const heard=/\b(who said|said in|in the (meeting|call|lecture|video|podcast)|did (he|she|they) say|professor|speaker)\b/i.test(text);
  const lean=(d:Doc)=>own&&d.kind==='writing'||heard&&d.kind==='media'?1.5:1;
  return [...ranks].map(([id,score])=>{const d=this.docs.get(id)!;return{...d,...raw.get(id),score:score*lean(d)};}).sort((a,b)=>b.score-a.score||b.at-a.at).slice(0,k);
 }
}
