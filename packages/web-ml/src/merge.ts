import type {Seam} from './chunking';

type Timed={word:string;start:number;end:number};
const mid=(w:Timed)=>(w.start+w.end)/2;
/** Words compared across windows: case, punctuation and width differences are not disagreements. */
export const normalizeWord=(word:string)=>word.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');

/** Joins the words of a new window onto the words so far. Both windows heard the overlap, so the same words appear
 * twice there, with times that differ by a little (each window aligns on its own). The two takes are aligned word by
 * word; the longest agreeing run is the anchor, and at its word nearest the seam's cut the earlier window hands over.
 * With nothing in common (silence, or the takes disagree), each window keeps the words centred on its side of the cut. */
export function mergeSeam<T extends Timed>(kept:T[],incoming:T[],seam:Seam,tolerance=1):T[]{
 let a=kept.length;while(a>0&&kept[a-1].end>seam.from-.5)a--;
 let b=0;while(b<incoming.length&&incoming[b].start<seam.to+.5)b++;
 const tail=kept.slice(a),head=incoming.slice(0,b);
 // Longest common subsequence over normalised text, counting a pair only when the two takes put it at about the same time.
 const n=tail.length,m=head.length,table=Array.from({length:n+1},()=>new Int32Array(m+1));
 const same=(i:number,j:number)=>{const x=normalizeWord(tail[i].word);return !!x&&x===normalizeWord(head[j].word)&&Math.abs(mid(tail[i])-mid(head[j]))<=tolerance;};
 for(let i=n-1;i>=0;i--)for(let j=m-1;j>=0;j--)table[i][j]=same(i,j)?table[i+1][j+1]+1:Math.max(table[i+1][j],table[i][j+1]);
 const pairs:[number,number][]=[];for(let i=0,j=0;i<n&&j<m;){if(same(i,j)&&table[i][j]===table[i+1][j+1]+1){pairs.push([i,j]);i++;j++;}else if(table[i+1][j]>=table[i][j+1])i++;else j++;}
 if(pairs.length){
  // Runs of consecutive agreement; a lone common word ("the") counts only when nothing longer agrees.
  const runs:[number,number][][]=[];for(const pair of pairs){const run=runs.at(-1),last=run?.at(-1);if(run&&last&&pair[0]===last[0]+1&&pair[1]===last[1]+1)run.push(pair);else runs.push([pair]);}
  const longest=Math.max(...runs.map(r=>r.length)),distance=(p:[number,number])=>Math.abs((mid(tail[p[0]])+mid(head[p[1]]))/2-seam.cut);
  const anchor=runs.filter(r=>r.length===longest).flat().sort((p,q)=>distance(p)-distance(q))[0];
  return[...kept.slice(0,a+anchor[0]+1),...incoming.slice(anchor[1]+1)];
 }
 // A word on the other side's half still counts when that side heard nothing at that moment (a window skipped as silent).
 const overlaps=(w:T,others:T[])=>others.some(o=>o.start<w.end+.1&&o.end>w.start-.1);
 const earlier=new Set(tail.filter(w=>mid(w)<seam.cut||!overlaps(w,head))),later=new Set(head.filter(w=>mid(w)>=seam.cut||!overlaps(w,tail)));
 const junction=[...earlier,...later].sort((x,y)=>x.start-y.start);
 // The same word just either side of the cut is one word heard twice.
 for(let i=junction.length-1;i>0;i--){const x=junction[i-1],y=junction[i];if(earlier.has(x)!==earlier.has(y)&&normalizeWord(x.word)===normalizeWord(y.word)&&Math.abs(mid(x)-mid(y))<=tolerance*2)junction.splice(later.has(y)?i:i-1,1);}
 return[...kept.slice(0,a),...junction,...incoming.slice(b)];
}

/** Greedy decoding can loop ("and the and the and the …") once it loses its place. A run of a 1–6 word phrase said more
 * than `keep` times back to back keeps its first `keep` takes: people say "no, no, no", but rarely a fourth time. */
export function collapseRepeats<T extends Timed>(words:T[],keep=3):T[]{
 const out=[...words];
 for(let size=1;size<=6;size++){
  for(let i=0;i+size*(keep+1)<=out.length;i++){
   const phrase=out.slice(i,i+size).map(w=>normalizeWord(w.word)).join(' ');if(!phrase.trim())continue;
   let repeats=1;while(i+size*(repeats+1)<=out.length&&out.slice(i+size*repeats,i+size*(repeats+1)).map(w=>normalizeWord(w.word)).join(' ')===phrase)repeats++;
   if(repeats>keep)out.splice(i+size*keep,size*(repeats-keep));
  }
 }
 return out;
}
