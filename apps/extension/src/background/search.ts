import MiniSearch from 'minisearch';
import {recent,type Passage,type Writing,type Note,type Media} from './db';
/** Searching what the user read, wrote and heard: one index over the passages of pages, their own writing, their notes
 * and what was said in meetings and videos, ranked by BM25 with fuzzy and prefix matches, newest first among equals.
 * Built from the sealed database when first needed and rebuilt after memory changes; held in the worker only. */
export type Found={id:string;kind:'page'|'writing'|'note'|'media';title:string;url?:string;text:string;at:number;site?:string;score:number;start?:number};
type Doc=Omit<Found,'score'>;
let index:{search:MiniSearch<Doc>;docs:Map<string,Doc>;at:number}|undefined,building:Promise<NonNullable<typeof index>>|undefined,stale=false;
export function memoryChanged(){stale=true;}

async function build(){
 const [passages,writing,notes,media]=await Promise.all([recent('passages',20_000),recent('writing',5_000),recent('notes',5_000),recent('media',500)]);
 const docs=new Map<string,Doc>();
 for(const p of passages as Passage[])docs.set('p'+p.id,{id:'p'+p.id,kind:p.kind==='media'?'media':'page',title:p.title,url:p.url,text:p.text,at:p.at,site:p.site});
 for(const w of writing as Writing[])docs.set('w'+w.id,{id:'w'+w.id,kind:'writing',title:`You wrote on ${w.site}${w.label?` (${w.label})`:''}`,url:w.url,text:w.text,at:w.at,site:w.site});
 for(const n of notes as Note[])docs.set('n'+n.id,{id:'n'+n.id,kind:'note',title:n.title??'Your note',url:n.url,text:n.text,at:n.at});
 for(const m of media as Media[]){
  // Each meeting or video as passages of about half a minute of speech, each pointing at its moment.
  let text='',start=0,speaker='';const flush=(i:number)=>{if(text)docs.set(`m${m.id}:${i}`,{id:`m${m.id}:${i}`,kind:'media',title:`${m.title}${speaker?` — ${speaker}`:''}`,url:m.url,text,at:m.startedAt+start*1000,site:m.site,start});text='';};
  m.segments.forEach((s,i)=>{if(text&&(s.start-start>30||s.speaker!==speaker))flush(i);if(!text){start=s.start;speaker=s.speaker;}text+=(text?' ':'')+s.text;});flush(m.segments.length);
  if(m.notes)docs.set(`mn${m.id}`,{id:`mn${m.id}`,kind:'media',title:`Notes: ${m.title}`,url:m.url,text:m.notes,at:m.endedAt??m.startedAt,site:m.site});
 }
 const search=new MiniSearch<Doc>({fields:['title','text'],storeFields:['id'],searchOptions:{boost:{title:2},prefix:true,fuzzy:0.15,combineWith:'OR'}});
 search.addAll([...docs.values()]);
 return{search,docs,at:Date.now()};
}
async function ready(){
 if(index&&!stale)return index;
 stale=false;
 return building??=build().then(built=>{index=built;return built;}).finally(()=>{building=undefined;});
}
export async function searchMemory(query:string,{k=6,since,kinds}:{k?:number;since?:number;kinds?:Found['kind'][]}={}):Promise<Found[]>{
 if(!query.trim())return[];
 try{
  const {search,docs}=await ready();
  return search.search(query).map(hit=>({...docs.get(hit.id as string)!,score:hit.score}))
   .filter(d=>(!since||d.at>=since)&&(!kinds||kinds.includes(d.kind)))
   .sort((a,b)=>b.score-a.score||b.at-a.at).slice(0,k);
 }catch{return[];}
}
