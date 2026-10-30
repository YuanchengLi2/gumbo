/** How memory chooses what a moment is given (memory/context.ts), kept apart so it can be tested: every candidate (a tab
 * open now, a page of this tab's trail, a passage read last week, something they wrote) is scored by what it shares with
 * the moment in meaning (cosine of embeddings) and in words (BM25, scaled to the best match of the question), how recent
 * it is (a half-life of an hour for this session, three days for the past), whether it belongs to the same project, the
 * same tab's chain or the same site, whether it was actually read (and for how long), and whether it helped a suggestion
 * that was taken before. The weights are config (memory/config.ts). Then the best are taken one by one, each new one
 * passed over if it says what a chosen one already says (maximal marginal relevance, by shared words), until the budget
 * is spent. */
export type Layer='now'|'session'|'project'|'profile'|'past';
export type Candidate={id:string;layer:Layer;kind:string;title:string;url?:string;text:string;at:number;site?:string;
 cos?:number;bm25?:number;project?:string;chain?:boolean;seenMs?:number;useful?:number;
 /** Always given (the page in front, the project note): scored first, never cut for repeating. */pinned?:boolean};
export type Weights={cos:number;bm25:number;recency:number;project:number;chain:number;site:number;seen:number;useful:number;tauSessionMs:number;tauPastMs:number;mmr:number};
export type Scored=Candidate&{score:number;parts:Record<string,number>};
export type Moment={now:number;project?:string;site?:string;words:string[]};

const STOP=new Set('the a an and or but if then so of to in on at by for with from as is are was were be been it its this that these those i you he she we they me my your our their not no do does did have has had will would can could should may might just also than too very into about over after before more most some any all each what which who when where why how there here out up down'.split(' '));
export const wordsOf=(text:string)=>[...new Set((text.toLowerCase().match(/[\p{L}\p{N}][\p{L}\p{N}'-]{1,}/gu)??[]).filter(w=>!STOP.has(w)&&w.length>2))];
/** A keyword score for candidates the search index did not score (this session's tabs and trail): the share of the
 * moment's words they hold. */
export const overlap=(words:string[],text:string)=>{if(!words.length)return 0;const t=text.toLowerCase();return words.filter(w=>t.includes(w)).length/words.length;};

/** Whether something search found bears on the moment (memory/context.ts, and scripts/relevance.ts, which sets the bar):
 * close enough in meaning (minCos: with this model unrelated texts score about 0.45 and answers about 0.7), or a strong
 * word match (minBm25 of the best, and 2 at least). With no meaning for it yet (the model loading, just seen), by how many
 * of the question's words it holds: two, or one in its title (BM25 alone grows with the size of memory, so a small one,
 * a new user's, could never match by words). */
export function bearing(found:{cos?:number;bm25?:number;words?:number}[],w:{minCos:number;minBm25:number;nearBest?:number}){
 const best=Math.max(0,...found.map(f=>f.bm25??0)),closest=Math.max(0,...found.map(f=>f.cos??0));
 const strong=(f:{bm25?:number})=>best>0&&(f.bm25??0)/best>=w.minBm25&&(f.bm25??0)>=2;
 // Close in meaning: above the bar, and (nearBest) near the moment's closest match. A question about a field is close to
 // many memories at once (every email is a little like an email being written); what is about it stands out above them.
 const close=(cos:number)=>cos>=w.minCos&&(w.nearBest===undefined||cos>=closest-w.nearBest);
 return(f:{cos?:number;bm25?:number;words?:number})=>f.cos!==undefined?close(f.cos)||strong(f):strong(f)||(f.words??0)>=2;
}
export function score(c:Candidate,m:Moment,w:Weights,bestBm25:number):Scored{
 const tau=c.layer==='past'?w.tauPastMs:w.tauSessionMs;
 const parts:Record<string,number>={
  cos:w.cos*Math.max(0,c.cos??0),
  bm25:w.bm25*(c.bm25!==undefined?(bestBm25>0?c.bm25/bestBm25:0):overlap(m.words,`${c.title} ${c.text}`)),
  recency:w.recency*Math.exp(-Math.max(0,m.now-c.at)/tau),
  project:m.project&&c.project===m.project?w.project:0,
  chain:c.chain?w.chain:0,
  site:m.site&&c.site===m.site?w.site:0,
  seen:w.seen*Math.min(1,Math.log1p((c.seenMs??0)/10_000)/Math.log1p(30)),
  useful:w.useful*Math.min(1,(c.useful??0)/3),
 };
 return{...c,score:(c.pinned?10:0)+Object.values(parts).reduce((a,b)=>a+b,0),parts};
}
const similarity=(a:Set<string>,b:Set<string>)=>{if(!a.size||!b.size)return 0;let n=0;for(const x of a)if(b.has(x))n++;return n/Math.min(a.size,b.size);};
/** The candidates in the order they are given, within a budget of characters. */
export function rank(candidates:Candidate[],m:Moment,w:Weights,budget:number):Scored[]{
 const best=Math.max(0,...candidates.map(c=>c.bm25??0));
 const scored=candidates.map(c=>score(c,m,w,best)).sort((a,b)=>b.score-a.score);
 const out:Scored[]=[],sets:Set<string>[]=[];let used=0;
 const pool=[...scored];
 while(pool.length&&used<budget){
  let pick=0,value=-Infinity;
  for(let i=0;i<pool.length;i++){
   const c=pool[i],set=new Set(wordsOf(c.text).slice(0,200));
   const redundancy=c.pinned?0:Math.max(0,...sets.map(s=>similarity(set,s)));
   const v=w.mmr*c.score-(1-w.mmr)*redundancy;
   if(v>value){value=v;pick=i;}
  }
  const [c]=pool.splice(pick,1),set=new Set(wordsOf(c.text).slice(0,200));
  // Something nearly all said already is left out.
  if(!c.pinned&&sets.some(s=>similarity(set,s)>0.85))continue;
  const size=c.title.length+c.text.length+40;if(used+size>budget&&out.length)continue;
  out.push(c);sets.push(set);used+=size;
 }
 return out;
}
