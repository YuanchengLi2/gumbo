import {recent} from '../db';
import type {Fact} from '../../shared/facts';
/** The working set: the facts of what the user saw lately (a booking's arrival time, an invoice's total, an order number,
 * an address), held ready in the worker as pages are kept and as each tab reports what is on its screen. Tab ranks them
 * against the moment on every keystroke, in a fraction of a millisecond, with no search and nothing read from disk, so
 * the fact the sentence just reached for ("our flight lands at") is in that very request, not the next one. Older memory
 * is still searched as before; this is the quick way for what was seen in the last hours. */
type Held={key:string;value:string;near?:string;title:string;url:string;at:number};
const MAX=600,HOURS_MS=6*3_600_000;
let held:Held[]=[],restored:Promise<void>|undefined;
const pageOf=(url:string)=>{try{const u=new URL(url);return u.origin+u.pathname;}catch{return url;}};
/** Facts seen on a page (kept, or on screen now): the newest first, each fact once. */
export function holdFacts(url:string,title:string,facts:Fact[]|undefined,at=Date.now()){
 if(!facts?.length)return;
 const page=pageOf(url),fresh=facts.slice(0,120).map(f=>({key:f.key,value:f.value,near:f.near,title:title.slice(0,120),url,at}));
 const same=(a:Held,b:Held)=>a.key===b.key&&a.value===b.value&&pageOf(a.url)===page;
 // A fact seen again keeps its latest sighting; the newest first, whatever order they came in.
 const kept=held.filter(h=>!fresh.some(f=>same(f,h))||h.at>at);
 held=[...fresh.filter(f=>!kept.some(h=>same(f,h))),...kept].filter(h=>Date.now()-h.at<HOURS_MS).sort((a,b)=>b.at-a.at).slice(0,MAX);
}
/** After the worker slept: the facts of the pages kept in the last hours come back from memory, once. */
function restore(){return restored??=recent('pages',40,Date.now()-HOURS_MS).then(pages=>{for(const p of pages)holdFacts(p.url,p.title,p.facts,p.lastSeen);}).catch(()=>{});}

const STOP=new Set('the a an and or but of to in on at by for with from as is are was were be it its this that i you we they me my your our their not no do does did have has had will would can could should just also than so if then what which who when where why how about into over after before more most some any all each'.split(' '));
const wordsOf=(text:string)=>[...new Set((text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'-]{2,}/gu)??[]).filter(w=>!STOP.has(w)))];
/** What kind of value a fact holds, read from the value itself. */
function kindOf(value:string):string{
 if(/[$€£¥]\s?\d|\d[\d,.]*\s?(usd|eur|gbp|dollars?)\b/i.test(value))return 'money';
 if(/@[\w-]+\.\w/.test(value))return 'email';
 if(/https?:\/\/|\bwww\.|\.\w{2,}\/\S/.test(value))return 'link';
 if(/\b\d{1,2}(:\d{2})?\s?(am|pm)\b|\b\d{1,2}:\d{2}\b/i.test(value))return 'time';
 if(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d|\b\d{1,2}\/\d{1,2}(\/\d{2,4})?\b|\b(mon|tues|wednes|thurs|fri|satur|sun)day\b/i.test(value))return 'date';
 if(/\b\d+\s+\w+(\s\w+)?\s(st|street|ave|avenue|rd|road|dr|drive|blvd|way|ln|lane|ct|court|pl|place)\b/i.test(value))return 'address';
 if(/\b(?=[\w-]*\d)[A-Z0-9][\w-]{4,}\b/.test(value))return 'id';
 return 'other';
}
/** What kinds of value the moment reaches for, from its own words (the question asked, the field, the sentence). */
function wantedOf(text:string):Set<string>{
 const t=text.toLowerCase(),want=new Set<string>();
 if(/how much|amount|total|price|cost|paid|pay|charge|fee|balance|owe|refund|\$|€|£/.test(t))want.add('money');
 if(/\b(time|when|lands?|arriv|depart|leav|starts?|ends?|o'clock|at$)/.test(t))want.add('time');
 if(/\b(date|when|day|due|deadline|until|by$|on$)/.test(t))want.add('date');
 if(/\b(address|where|located|location|street|venue|ship|deliver)/.test(t))want.add('address');
 if(/\b(number|order|tracking|confirmation|invoice|reference|code|id\b|#)/.test(t))want.add('id');
 if(/\b(e-?mail)/.test(t))want.add('email');
 if(/\b(link|url|website|site|board|send me)/.test(t))want.add('link');
 return want;
}
/** The facts that bear on the moment, best first: what shares the moment's words (in its key, the words near it, its
 * page's title), what is the kind of value the moment asks for, then what was seen most lately. With little to go on (a
 * sentence in another language, an empty field with a bare label), the facts of what was seen in the last quarter hour
 * come too: the model judges what is relevant, and the facts check holds whatever it takes to what it was shown. The page
 * in front is left out (its facts are in front of them already). */
export function factsFor(moment:{text:string;url?:string},limit=8):Held[]{
 void restore();
 const now=Date.now(),here=moment.url?pageOf(moment.url):'',words=wordsOf(moment.text),want=wantedOf(moment.text);
 const scored=held.filter(h=>pageOf(h.url)!==here).map(h=>{
  const about=`${h.key} ${h.near??''} ${h.title}`.toLowerCase(),shared=words.filter(w=>about.includes(w)).length,kind=kindOf(h.value);
  const score=shared+(want.has(kind)?3:0)+Math.exp(-(now-h.at)/1_800_000);
  return{h,score,related:shared>0||want.has(kind)};
 }).sort((a,b)=>b.score-a.score);
 const related=scored.filter(s=>s.related).slice(0,limit).map(s=>s.h);
 if(related.length>=3)return related;
 const lately=scored.filter(s=>!s.related&&now-s.h.at<900_000).slice(0,Math.max(0,Math.min(4,limit-related.length))).map(s=>s.h);
 return[...related,...lately];
}
const ago=(at:number)=>{const m=Math.round((Date.now()-at)/60_000);return m<1?'just now':m<60?`${m} min ago`:`${Math.round(m/60)} h ago`;};
/** The facts as the prompt's block, right before the text being typed (empty when there are none). */
export function factsBlock(facts:Held[]):string{
 if(!facts.length)return '';
 return `<facts_from_what_they_saw>\n${facts.map(f=>`- ${f.key}: ${f.value} (${f.title.slice(0,70)}, ${ago(f.at)})`).join('\n')}\n</facts_from_what_they_saw>\n`;
}
