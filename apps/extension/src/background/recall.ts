import {recent,type Writing,type Page,type Media,type SuggestionRecord} from './db';
import {loadSettings} from '../shared/settings';
import {emptyRecall,type Recall} from '../shared/prompts';
import {memoryChanged} from './search';
/** What Tab and Ctrl+K take from memory while the user types: it must answer in a few milliseconds, so the recent part
 * of memory (writing, accepted suggestions, the last day's pages and listening) is held in the worker and refreshed as
 * it changes; a keyword match finds the passages that fit what is being written. With nothing in memory every surface
 * still works: recall is empty, not an error. */
type Cache={at:number;writing:Writing[];accepted:SuggestionRecord[];pages:{page:Page;passages:string[]}[];media:Media[]};
let cache:Cache|undefined,loading:Promise<Cache>|undefined;
const DAY=86_400_000;
export function invalidate(){cache=undefined;memoryChanged();}

async function load():Promise<Cache>{
 if(cache&&Date.now()-cache.at<30_000)return cache;
 return loading??=(async()=>{
  try{
   const now=Date.now();
   const [writing,suggestions,pages,media]=await Promise.all([recent('writing',300),recent('suggestions',400),recent('pages',60,now-DAY),recent('media',20,now-2*DAY)]);
   cache={at:now,writing,accepted:suggestions.filter(s=>s.outcome==='accepted'||s.outcome==='partial'),pages:pages.map(page=>({page,passages:passagesOf(page.text)})),media};
   return cache;
  }catch{return cache={at:Date.now(),writing:[],accepted:[],pages:[],media:[]};}
  finally{loading=undefined;}
 })();
}
/** Splits page text into passages of a few hundred characters at paragraph and sentence ends. */
export function passagesOf(text:string,size=600):string[]{
 const out:string[]=[];let current='';
 for(const part of text.split(/\n+|(?<=[.!?])\s+/)){
  if(current&&current.length+part.length>size){out.push(current.trim());current='';}
  current+=(current?' ':'')+part;
 }
 if(current.trim())out.push(current.trim());return out;
}
const stop=new Set('the a an and or but if then so of to in on at by for with from as is are was were be been it its this that these those i you he she we they me my your our their his her them us not no yes do does did have has had will would can could should may might just also than too very into about over after before more most some any all each other such only own same what which who whom when where why how there here out up down off again further once hi hello thanks thank please dear best regards'.split(' '));
export function keywords(text:string,max=12){
 const counts=new Map<string,number>();
 for(const word of text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'-]{2,}/gu)??[])if(!stop.has(word))counts.set(word,(counts.get(word)??0)+1);
 return [...counts.keys()].slice(-max);
}
/** Scores passages by the keywords they share, rarer words counting more. */
function best<T>(items:T[],textOf:(item:T)=>string,words:string[],take:number,min=2):T[]{
 if(!words.length)return[];
 const lower=items.map(i=>textOf(i).toLowerCase()),df=new Map(words.map(w=>[w,lower.filter(t=>t.includes(w)).length]));
 return items.map((item,i)=>({item,score:words.reduce((s,w)=>s+(lower[i].includes(w)?Math.log(1+items.length/(df.get(w)||1)):0),0),hits:words.filter(w=>lower[i].includes(w)).length}))
  .filter(x=>x.hits>=Math.min(min,words.length)).sort((a,b)=>b.score-a.score).slice(0,take).map(x=>x.item);
}

export async function recallFor(input:{site:string;intent:string;before:string;thread?:string;current?:string}):Promise<Recall>{
 const recall=emptyRecall();
 try{
  const [c,settings]=await Promise.all([load(),loadSettings()]);
  recall.facts=settings.facts;
  // The user's own writing in the same kind of field, this site first; never the text being written now.
  const same=c.writing.filter(w=>w.intent===input.intent&&w.text.length>=30&&w.text!==input.current);
  recall.style=[...same.filter(w=>w.site===input.site),...same.filter(w=>w.site!==input.site)].slice(0,3).map(w=>({site:w.site,intent:w.intent,text:w.text}));
  recall.accepted=c.accepted.filter(s=>s.site===input.site&&s.kind==='text').slice(0,5).map(s=>s.text.trim()).filter(Boolean);
  const words=keywords(`${input.thread??''}\n${input.before.slice(-600)}`);
  const passages=c.pages.filter(p=>p.page.site!==input.site||true).flatMap(p=>p.passages.map(text=>({title:p.page.title,url:p.page.url,text})));
  recall.reading=best(passages,p=>p.text,words,2);
  const segments=c.media.flatMap(m=>windows(m).map(w=>({title:m.title,speaker:w.speaker,text:w.text})));
  recall.heard=best(segments,s=>s.text,words,2);
 }catch{}
 return recall;
}
/** A meeting or video as passages of about half a minute of speech each. */
function windows(media:Media){
 const out:{speaker?:string;text:string}[]=[];let text='',speaker:string|undefined,start=0;
 for(const s of media.segments){if(text&&(s.start-start>30||s.speaker!==speaker)){out.push({speaker,text});text='';}if(!text){start=s.start;speaker=s.speaker;}text+=(text?' ':'')+s.text;}
 if(text)out.push({speaker,text});return out;
}
