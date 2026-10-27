/** The arithmetic of projects (memory/projects.ts), kept apart so it can be tested: a visit's gist and a project's centre
 * are unit vectors, and a visit joins the project it is closest to, helped by the chain it came along (the page before it
 * was in that project a moment ago) and the site (the project has been on it), when that clears the threshold. The
 * threshold is learned on this computer: gists of pages reached one from the other within half an hour (the same work,
 * mostly) against gists of pages on different sites on different days (different work, mostly), and the cut that best
 * tells the two apart (Youden's J). */
export type Centre={id:string;centroid?:number[];sites:string[];candidate?:boolean;visits:number};
export const unit=(v:ArrayLike<number>)=>{let n=0;for(let i=0;i<v.length;i++)n+=v[i]*v[i];n=Math.sqrt(n)||1;return Array.from(v,x=>x/n);};
export const cosine=(a:ArrayLike<number>,b:ArrayLike<number>)=>{let dot=0,na=0,nb=0;for(let i=0;i<a.length;i++){dot+=a[i]*b[i];na+=a[i]*a[i];nb+=b[i]*b[i];}return na&&nb?dot/Math.sqrt(na*nb):0;};
/** A project's centre after one more visit: the running mean, made unit length again. */
export const moved=(centre:number[]|undefined,gist:number[],n:number)=>centre?unit(centre.map((x,i)=>(x*n+gist[i])/(n+1))):unit(gist);
export function choose(input:{gist?:number[];site:string;chain?:string;projects:Centre[];join:number;chainBonus:number;siteBonus:number}):{id?:string;score:number}{
 let best:{id?:string;score:number}={score:-1};
 for(const p of input.projects){
  const score=(input.gist&&p.centroid?cosine(input.gist,p.centroid):0)+(p.id===input.chain?input.chainBonus:0)+(p.sites.includes(input.site)?input.siteBonus:0);
  if(score>best.score)best={id:p.id,score};
 }
 return best.score>=input.join?best:{score:best.score};
}
export function histogram(values:number[],bins=20):number[]{const out=Array(bins).fill(0);for(const v of values)out[Math.max(0,Math.min(bins-1,Math.floor(v*bins)))]++;return out;}
/** The cut between two sets of similarities that best tells them apart: the one with the most of the first above it and
 * the fewest of the second (the largest share-above difference). */
export function threshold(same:number[],other:number[]):number{
 if(!same.length||!other.length)return NaN;
 let best={t:0.8,j:-1};
 for(let i=30;i<=98;i++){const t=i/100,tp=same.filter(v=>v>=t).length/same.length,fp=other.filter(v=>v>=t).length/other.length;if(tp-fp>best.j)best={t,j:tp-fp};}
 return best.t;
}
/** The bar a visit's similarity must clear to join a project on meaning alone: the best cut, but never one that lets in
 * more than a tenth of unrelated pairs (titles alone tell work apart only loosely: on the first computer measured, the
 * best cut let in 41% of them). A visit reached from the project, or on its site, gets there with its bonus. */
export function joinBar(same:number[],other:number[]):number{
 const sorted=[...other].sort((a,b)=>a-b),p90=sorted[Math.floor(0.9*(sorted.length-1))]??0.7;
 return Math.round(Math.max(threshold(same,other),p90+0.01)*100)/100;
}
