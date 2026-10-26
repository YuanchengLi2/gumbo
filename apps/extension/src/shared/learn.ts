/** What Gumbo learns from what the user does, for Tab's next-step chips. All of it stays on the computer.
 * - A page's kind is its address with the parts that change from one item to the next (numbers, ids, hashes, emails)
 *   replaced by *, so "every Supabase project's logs page" is one kind, and the last address of a kind is remembered.
 * - Each step (a click, by the role and name of what was clicked; a visit, by page kind) is counted after the step that
 *   came before it on the same kind of page, by hour and weekday, with old habits fading (half-life of a month).
 * - The steps likely next are those that followed the same step on the same kind of page often enough; a habit seen
 *   at least five times and taken seven times in ten is strong enough to offer with no model asked. */
export type Target={role?:string;name?:string;path?:string;nearby?:string};
export type Step={kind:'click'|'navigate';pageKind:string;key:string;label:string;target?:Target;url?:string;title?:string;at:number};
type Stat={count:number;hours:number[];days:number[];last:number};
export type Candidate={step:Step;p:number;count:number;strong:boolean;why:string};
const HALF_LIFE=30*86_400_000;

const idLike=/^(\d+|[0-9a-f]{8,}|[0-9a-f-]{20,}|[A-Za-z0-9_-]{22,}|[^@/]+@[^@/]+)$/i;
/** The kind of page an address is: the same for every item of a list, project or thread. */
export function pageKindOf(url:string):string{
 let u:URL;try{u=new URL(url);}catch{return url;}
 // An id: numbers, hashes, long tokens; a word of a path is short or hyphenated, so one unbroken token of 16+ letters is
 // an id too (a Supabase project ref, a document key).
 const segment=(s:string)=>!s?s:idLike.test(s)||/\d{4,}/.test(s)&&/[a-z]/i.test(s)&&s.length>10||s.length>=16&&!/[-_.~]/.test(s)?'*':s.toLowerCase();
 const path=u.pathname.split('/').map(segment).join('/').replace(/\/+$/,'')||'/';
 // An app that routes in the hash (#/inbox/123, Gmail's #inbox/<id>) keeps its route; a lone #anchor is the same page.
 const route=u.hash.slice(1).replace(/^[/!]+/,'').split('?')[0];
 const hash=route.includes('/')||/^#[/!]/.test(u.hash)?'#'+route.split('/').map(segment).join('/'):'';
 return u.hostname.replace(/^www\./,'')+path+hash;
}
export const clickKey=(role:string,name:string)=>`${role}:${name.toLowerCase().replace(/\s+/g,' ').trim().slice(0,80)}`;

export class Learner{
 /** context ("pageKind|previous step") → next step key → counts. */
 next=new Map<string,Map<string,Stat>>();
 /** The latest of each step, to replay it. */
 steps=new Map<string,Step>();
 private stat(map:Map<string,Stat>,key:string){let s=map.get(key);if(!s){s={count:0,hours:Array(24).fill(0),days:Array(7).fill(0),last:0};map.set(key,s);}return s;}
 private bump(context:string,step:Step){
  let map=this.next.get(context);if(!map){map=new Map();this.next.set(context,map);}
  const s=this.stat(map,step.key),when=new Date(step.at),fade=s.last?Math.pow(0.5,Math.max(0,step.at-s.last)/HALF_LIFE):1;
  s.count=s.count*fade+1;s.hours[when.getHours()]++;s.days[when.getDay()]++;s.last=Math.max(s.last,step.at);
 }
 /** Learns that `step` came after `prev` (on the page kind `step` was taken from). */
 observe(prev:Step|undefined,step:Step){
  const page=step.kind==='click'?step.pageKind:prev?.pageKind??'start';
  this.bump(`${page}|${prev?.key??'start'}`,step);
  // A looser context (any previous step on that kind of page), for when the exact one has not been seen.
  this.bump(`${page}|*`,step);
  this.steps.set(step.key,step);
 }
 candidates(context:{pageKind:string;prev?:Step;now?:number},limit=5):Candidate[]{
  const now=context.now??Date.now(),when=new Date(now),out=new Map<string,Candidate>();
  for(const [contextKey,loose] of [[`${context.pageKind}|${context.prev?.key??'start'}`,false],[`${context.pageKind}|*`,true]] as const){
   const map=this.next.get(contextKey);if(!map)continue;
   let total=0;const weighted:[string,number,Stat][]=[];
   for(const [key,s] of map){const fade=Math.pow(0.5,Math.max(0,now-s.last)/HALF_LIFE),hour=(s.hours[when.getHours()]+s.hours[(when.getHours()+23)%24]+s.hours[(when.getHours()+1)%24])/Math.max(1,s.hours.reduce((a,b)=>a+b,0));const w=s.count*fade*(0.6+0.8*hour);weighted.push([key,w,s]);total+=w;}
   for(const [key,w,s] of weighted){
    const step=this.steps.get(key);if(!step||key===context.prev?.key&&step.kind==='click')continue;
    const p=w/total*(loose?0.8:1),count=Math.round(s.count*10)/10;
    if(count<3)continue;
    const prior=out.get(key);if(prior&&prior.p>=p)continue;
    out.set(key,{step,p,count,strong:!loose&&count>=5&&p>=0.7,why:`${Math.round(count)} times after ${context.prev?.label??'opening this kind of page'}`});
   }
  }
  return [...out.values()].sort((a,b)=>b.p-a.p).slice(0,limit);
 }
 toJSON(){return{next:[...this.next].map(([k,m])=>[k,[...m]]),steps:[...this.steps]};}
 /** The action meter: the user's own steps replayed in order, each predicted from what came before it. A chip would
  * have shown when the best candidate was strong (or likely enough for the model to pick it); it was right when that
  * candidate was the step the user actually took next. */
 static meter(steps:Step[],threshold=0.5){
  const learner=new Learner();let shown=0,right=0,strongShown=0,strongRight=0;
  for(let i=0;i<steps.length;i++){
   const prev=i&&steps[i].at-steps[i-1].at<30*60_000?steps[i-1]:undefined,step=steps[i];
   const [best]=learner.candidates({pageKind:step.kind==='click'?step.pageKind:prev?.pageKind??'start',prev,now:step.at},1);
   if(best&&(best.strong||best.p>=threshold)){shown++;if(best.step.key===step.key)right++;if(best.strong){strongShown++;if(best.step.key===step.key)strongRight++;}}
   learner.observe(prev,step);
  }
  return{steps:steps.length,shown,right,precision:shown?right/shown:0,strongShown,strongPrecision:strongShown?strongRight/strongShown:0};
 }
 static from(json:any):Learner{const l=new Learner();if(json){l.next=new Map((json.next??[]).map(([k,m]:[string,[string,Stat][]])=>[k,new Map(m)]));l.steps=new Map(json.steps??[]);}return l;}
}
