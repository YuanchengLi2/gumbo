import {searchMemory,type Found} from './search';
import {recent,touchPages} from './db';
import {clock} from '../shared/moment';
/** Memory that bears on what the user is doing, for every surface, every time: Tab, Ctrl+K and the agent never decide
 * whether to look; they are always given it. All of memory is searched, by meaning and by words (pages read, their own
 * writing, what was heard, notes, what they asked Gumbo), with the moment as the question: the page, the field and its
 * label, the conversation above it, the sentence being written, or what they asked.
 * - A field is searched the moment it is focused, and again each time a sentence is finished; Tab reads the latest
 *   result at once and never waits for a search.
 * - Ctrl+K and the agent search as they are asked (a few tens of milliseconds, in the offscreen document).
 * - What is being heard right now (a call, a video), or was a minute ago, comes first when it is relevant to ask about. */
export type Remembered={n:number;kind:Found['kind'];title:string;url?:string;when:string;text:string};
const toRemembered=(f:Found,n:number):Remembered=>({n,kind:f.kind,title:f.title,url:f.url,when:new Date(f.at).toLocaleDateString('en-US',{month:'short',day:'numeric'})+(f.kind==='media'&&f.start!==undefined?`, at ${clock(f.start)}`:''),text:f.text});
const same=(a?:string,b?:string)=>{try{const x=new URL(a!),y=new URL(b!);return x.origin+x.pathname===y.origin+y.pathname;}catch{return false;}};

/** Searches all of memory for a moment; the page the user is on is left out (they already have it in front of them). */
export async function relevant(query:string,options:{k?:number;page?:string}={}):Promise<Remembered[]>{
 const found=await searchMemory(query.slice(0,1500),{k:(options.k??4)+2}).catch(()=>[] as Found[]);
 const out=found.filter(f=>!options.page||!same(f.url,options.page)).slice(0,options.k??4);
 // Pages memory keeps bringing up are the ones worth keeping longest when it runs short of room.
 const fresh=out.filter(f=>f.kind==='page'&&f.url&&Date.now()-(touched.get(f.url)??0)>600_000).map(f=>f.url!);
 if(fresh.length){for(const u of fresh)touched.set(u,Date.now());if(touched.size>2000)touched.clear();void touchPages(fresh);}
 return out.map((f,i)=>toRemembered(f,i+1));
}
const touched=new Map<string,number>();

/** What a field is about, as a question to memory: its page, its label, the last messages above it, the last sentence. */
export function fieldQuery(input:{title?:string;label?:string;thread?:{author?:string;text:string}[];headings?:string[];sentence?:string}){
 return[input.title,input.label,...(input.thread??[]).slice(-2).map(m=>`${m.author?`${m.author}: `:''}${m.text.slice(0,400)}`),...(input.headings??[]).slice(0,2),input.sentence].filter(Boolean).join('\n');
}
type Field={query:string;items:Remembered[];at:number;searching?:Promise<void>};
const fields=new Map<string,Field>();
/** The memory a field has now (instantly), and a fresh search behind it when the question moved on (a new sentence, a
 * new message above): its answer is there for the next suggestion. Tab for actions asks for as much as the agent gets. */
export function fieldMemory(key:string,query:string,page?:string,k=3):Remembered[]{
 let field=fields.get(key);
 if(!field){field={query:'',items:[],at:0};fields.set(key,field);if(fields.size>200)fields.delete(fields.keys().next().value!);}
 if(query!==field.query&&!field.searching){
  const asked=query;field.query=query;
  field.searching=relevant(asked,{k,page}).then(items=>{field!.items=items;field!.at=Date.now();}).finally(()=>{field!.searching=undefined;});
 }
 return field.items;
}
/** Waits (briefly) for a field's first search only: the first suggestion after focusing a field gets memory too, and a
 * field memory has nothing for never waits again. */
export async function fieldReady(key:string,ms=80){const field=fields.get(key);if(field?.searching&&!field.at)await Promise.race([field.searching,new Promise(r=>setTimeout(r,ms))]);return fields.get(key)?.items??[];}
/** Waits (up to ms) for the search a new question started, however many came before it: what Tab for actions asks is
 * the moment as it is now (the field just entered), and an answer for the page as it opened is the wrong memory. */
export async function fieldCurrent(key:string,ms:number){const field=fields.get(key);if(field?.searching)await Promise.race([field.searching,new Promise(r=>setTimeout(r,ms))]);return{items:fields.get(key)?.items??[],searching:!!fields.get(key)?.searching};}
export const fieldKey=(site:string,intent:string,label:string,thread?:{text:string}[])=>`${site}|${intent}|${label}|${thread?.at(-1)?.text.slice(0,80)??''}`;
/** The last finished sentence of what is being written (memory is searched again only when it changes). */
export function lastSentence(before:string){const done=before.match(/[^.!?\n]{8,}[.!?\n]/g);return done?.at(-1)?.trim()??'';}
/** What is being written, as a question to memory: the last finished sentence and the one under way, the latter in
 * steps of two words, so memory follows the writing closely without a search on every keystroke (a search is local and
 * takes a few tens of milliseconds). */
export function writingQuery(before:string){
 const words=(before.split(/[.!?\n]/).at(-1)??'').trim().split(/\s+/).filter(Boolean);
 return[lastSentence(before),words.slice(0,Math.floor(words.length/2)*2).join(' ')].filter(Boolean).join(' ');
}

/** What is being heard, or was in the last quarter hour: its last lines, newest last. */
export async function heardJustNow(lines=10):Promise<Remembered|undefined>{
 const [latest]=await recent('media',1).catch(()=>[]);
 if(!latest||!latest.segments.length||Date.now()-(latest.endedAt??Date.now())>15*60_000)return;
 const last=latest.segments.slice(-lines);
 return{n:0,kind:'media',title:`${latest.title} (${latest.endedAt?'just now':'now'})`,url:latest.url,when:`at ${clock(last[0].start)}`,text:last.map(s=>`${s.speaker?`${s.speaker}: `:''}${s.text}`).join('\n')};
}
/** A question about what was just said ("what did she just say?", "what was that number?"). */
export const asksAboutNow=(text:string)=>/\b(just|a (moment|minute|second) ago|right now|earlier|last thing|what was that|did (he|she|they) say)\b/i.test(text);
