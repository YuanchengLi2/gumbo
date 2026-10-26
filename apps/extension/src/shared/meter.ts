/** Tab's accuracy meter: moments are cut from real writing (the user's own, or a fixed set for development), the text
 * before a word boundary goes to Tab, and its suggestion is scored against what the writer actually typed next:
 * - exact: the suggestion's words are the next words written;
 * - close: most of its words come next, in a slightly different order or form (or a judge model calls it a continuation
 *   the writer would accept);
 * - wrong: it showed something else;
 * - none: it showed nothing.
 * Precision (exact + close, of what showed) is the number that matters: when Tab shows something, it must be right. */
export type Sample={site:string;intent:string;label:string;singleLine?:boolean;thread?:{author?:string;text:string}[];page?:string;title?:string;text:string};
export type Moment={sample:Sample;before:string;truth:string;after:string};
export type Score='exact'|'close'|'wrong'|'none';

/** Seeded pick of moments: a cut after at least three words, with at least two words still to come, inside a sentence
 * more often than at its end (the common case while typing). */
export function momentsFrom(samples:Sample[],count:number,seed=7):Moment[]{
 let state=seed;const random=()=>{state=(state*1103515245+12345)%2147483648;return state/2147483648;};
 const out:Moment[]=[];
 for(let i=0;out.length<count&&i<count*20;i++){
  const sample=samples[Math.floor(random()*samples.length)];
  const cuts=[...sample.text.matchAll(/\s+/g)].map(m=>m.index!).filter(at=>sample.text.slice(0,at).trim().split(/\s+/).length>=3&&sample.text.slice(at).trim().split(/\s+/).length>=2);
  if(!cuts.length)continue;
  const at=cuts[Math.floor(random()*cuts.length)],before=sample.text.slice(0,at),rest=sample.text.slice(at);
  // The sentence being written is what Tab finishes; text after it would not be there yet.
  const end=/[.!?](\s|$)|\n/.exec(rest),truth=end?rest.slice(0,end.index+1):rest;
  if(out.some(m=>m.sample===sample&&m.before===before))continue;
  out.push({sample,before,truth,after:''});
 }
 return out;
}
const words=(text:string)=>text.toLowerCase().replace(/[^\p{L}\p{N}\s']/gu,' ').split(/\s+/).filter(Boolean);
export function score(suggestion:string,truth:string):Score{
 const s=words(suggestion),t=words(truth);
 if(!s.length)return 'none';
 // A finished half-word joins the last word typed: compare on the raw text for those.
 if(truth.toLowerCase().trimStart().startsWith(suggestion.toLowerCase().trim()))return 'exact';
 if(s.every((w,i)=>t[i]===w))return 'exact';
 const window=t.slice(0,s.length+3),hits=s.filter(w=>window.includes(w)).length;
 return hits/s.length>=0.6&&window.length?'close':'wrong';
}
/** How many of the suggestion's first words are the words written next (what Ctrl+→ would take, word by word). */
export function rightWords(suggestion:string,truth:string){const s=words(suggestion),t=words(truth);let k=0;while(k<s.length&&s[k]===t[k])k++;return k;}
export type Summary={n:number;shown:number;exact:number;close:number;wrong:number;precision:number;showRate:number;firstWordRight:number;medianFirstMs?:number;p90FirstMs?:number};
export function summarize(results:{score:Score;firstMs?:number;suggestion?:string;truth?:string}[]):Summary{
 const n=results.length,count=(s:Score)=>results.filter(r=>r.score===s).length,shown=n-count('none');
 const times=results.map(r=>r.firstMs).filter((v):v is number=>v!==undefined).sort((a,b)=>a-b);
 const firstRight=results.filter(r=>r.score!=='none'&&r.suggestion!==undefined&&rightWords(r.suggestion,r.truth??'')>0).length;
 return{n,shown,exact:count('exact'),close:count('close'),wrong:count('wrong'),precision:shown?(count('exact')+count('close'))/shown:0,showRate:n?shown/n:0,firstWordRight:shown?firstRight/shown:0,
  medianFirstMs:times.length?times[Math.floor(times.length/2)]:undefined,p90FirstMs:times.length?times[Math.min(times.length-1,Math.floor(times.length*0.9))]:undefined};
}
