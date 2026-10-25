/** Who speaks when: speech is cut into 3-second windows, each window's voice is turned into an embedding by the speaker
 * model, and the embeddings are grouped. Windows of one voice point the same way; a new voice points elsewhere. Shorter
 * windows tell voices apart less surely (1.5 s split a single lecturer into five), and a transcript line takes the voice
 * that covers most of it, so turns need not be finer than this. */
export type SpeakerWindow={start:number;end:number;region:number};
export type SpeakerTurn={start:number;end:number;speaker:string};
export const WINDOW_SEC=3;

/** Windows over the stretches of speech, end to end: 3 s each, the last one of a stretch reaching back to fill 3 s; a
 * stretch of 1.5 to 3 s is one shorter window; anything shorter is too short to tell a voice by. */
export function speakerWindows(regions:{start:number;end:number}[]):SpeakerWindow[]{
 const out:SpeakerWindow[]=[];
 regions.forEach((r,region)=>{
  const length=r.end-r.start;if(length<1.5)return;
  if(length<WINDOW_SEC){out.push({start:r.start,end:r.end,region});return;}
  for(let start=r.start;start+WINDOW_SEC<=r.end+1e-6;start+=WINDOW_SEC)out.push({start,end:start+WINDOW_SEC,region});
  const last=out[out.length-1];if(last.end<r.end-.75)out.push({start:r.end-WINDOW_SEC,end:r.end,region});
 });
 return out;
}

export const normalise=(v:Float32Array)=>{let s=0;for(const x of v)s+=x*x;const n=Math.sqrt(s)||1;const out=new Float32Array(v.length);for(let i=0;i<v.length;i++)out[i]=v[i]/n;return out;};
const dot=(a:Float32Array,b:Float32Array)=>{let s=0;for(let i=0;i<a.length;i++)s+=a[i]*b[i];return s;};

/** Average-linkage clustering of unit vectors by cosine similarity, merging while the closest pair of clusters is at
 * least this similar. Returns a cluster number per vector. */
function agglomerate(vectors:Float32Array[],threshold:number){
 const n=vectors.length,similarity=new Float32Array(n*n),size=new Int32Array(n).fill(1),alive=new Uint8Array(n).fill(1),owner=Int32Array.from({length:n},(_,i)=>i);
 for(let i=0;i<n;i++)for(let j=i+1;j<n;j++){const s=dot(vectors[i],vectors[j]);similarity[i*n+j]=s;similarity[j*n+i]=s;}
 for(;;){
  let best=-Infinity,a=-1,b=-1;
  for(let i=0;i<n;i++)if(alive[i])for(let j=i+1;j<n;j++)if(alive[j]&&similarity[i*n+j]>best){best=similarity[i*n+j];a=i;b=j;}
  if(a<0||best<threshold)break;
  // Lance-Williams update for average linkage: the merged cluster's similarity to k is the size-weighted mean.
  for(let k=0;k<n;k++)if(alive[k]&&k!==a&&k!==b){const s=(size[a]*similarity[a*n+k]+size[b]*similarity[b*n+k])/(size[a]+size[b]);similarity[a*n+k]=s;similarity[k*n+a]=s;}
  size[a]+=size[b];alive[b]=0;for(let i=0;i<n;i++)if(owner[i]===b)owner[i]=a;
 }
 return owner;
}
function centroids(vectors:Float32Array[],labels:number[],count:number){
 const dim=vectors[0]?.length??0,sums=Array.from({length:count},()=>new Float32Array(dim));
 vectors.forEach((v,i)=>{const s=sums[labels[i]];for(let d=0;d<dim;d++)s[d]+=v[d];});
 return sums.map(normalise);
}
const nearest=(v:Float32Array,centres:Float32Array[])=>{let best=-Infinity,arg=0;centres.forEach((c,i)=>{const s=dot(v,c);if(s>best){best=s;arg=i;}});return arg;};

/** A speaker per window. Long recordings are clustered on an even sample of their windows (at most 500), then every window
 * joins the nearest voice and the voices are re-centred twice. A voice heard in fewer than three windows, or under 2% of
 * them, is folded into the nearest other: a cough or a stray word is not a person. The threshold (cosine similarity 0.5)
 * keeps one lecturer as one voice and still parts two people talking. */
export function clusterVoices(embeddings:Float32Array[],threshold=.5){
 const n=embeddings.length;if(!n)return[];
 const vectors=embeddings.map(normalise),step=Math.max(1,n/500),sample=Array.from({length:Math.min(n,500)},(_,i)=>Math.floor(i*step));
 const owner=agglomerate(sample.map(i=>vectors[i]),threshold),roots=[...new Set(owner)],index=new Map(roots.map((r,i)=>[r,i]));
 let centres=centroids(sample.map(i=>vectors[i]),[...owner].map(o=>index.get(o)!),roots.length),labels=vectors.map(v=>nearest(v,centres));
 for(let pass=0;pass<2;pass++){centres=centroids(vectors,labels,centres.length);labels=vectors.map(v=>nearest(v,centres));}
 for(;;){
  const counts=centres.map((_,c)=>labels.filter(l=>l===c).length),small=counts.findIndex(c=>c>0&&c<Math.max(3,n*.02)&&counts.filter(x=>x>0).length>1);
  if(small<0)break;
  const others=centres.map((c,i)=>i!==small&&counts[i]>0?c:undefined);
  labels=labels.map((l,i)=>l!==small?l:others.reduce((best,c,k)=>c&&(best<0||dot(vectors[i],c)>dot(vectors[i],others[best]!))?k:best,-1));
 }
 return labels;
}

/** Turns from windows and their speakers: consecutive windows of one voice join (where the last window of a stretch
 * overlaps the one before, the overlap is split), and letters go A, B, C… in the order the voices are first heard. */
export function speakerTurns(windows:SpeakerWindow[],labels:number[]):{turns:SpeakerTurn[];share:Record<string,number>;count:number}{
 const letters=new Map<number,string>();for(const l of labels)if(!letters.has(l))letters.set(l,String.fromCharCode(65+letters.size));
 const turns:SpeakerTurn[]=[];
 windows.forEach((w,i)=>{
  const speaker=letters.get(labels[i])!,prev=windows[i-1],next=windows[i+1];
  const start=prev&&prev.region===w.region&&prev.end>w.start?(prev.end+w.start)/2:w.start,end=next&&next.region===w.region&&next.start<w.end?(next.start+w.end)/2:w.end;
  const last=turns[turns.length-1];
  if(last&&last.speaker===speaker&&start-last.end<1)last.end=Math.max(last.end,end);else turns.push({start:Math.round(start*100)/100,end:Math.round(end*100)/100,speaker});
 });
 for(const t of turns)t.end=Math.round(t.end*100)/100;
 const total=turns.reduce((s,t)=>s+t.end-t.start,0)||1,share:Record<string,number>={};
 for(const t of turns)share[t.speaker]=(share[t.speaker]??0)+(t.end-t.start)/total;
 for(const k of Object.keys(share))share[k]=Math.round(share[k]*100)/100;
 return{turns,share,count:letters.size};
}

/** The speaker at a moment, or undefined between turns. */
export function speakerAt(turns:SpeakerTurn[],at:number){
 let lo=0,hi=turns.length-1;while(lo<=hi){const mid=(lo+hi)>>1,t=turns[mid];if(at<t.start)hi=mid-1;else if(at>t.end)lo=mid+1;else return t.speaker;}
 return undefined;
}
