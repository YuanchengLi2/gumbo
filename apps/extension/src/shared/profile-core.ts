/** The profile's own logic (memory/profile.ts), kept apart so it can be tested: what it holds, how a change the model
 * proposes is merged into it (never regenerated: an update adds, changes or removes one thing at a time), and what is
 * learned from the user's writing and visits on this computer without any model: the facts they type again and again,
 * how they open and close messages in each kind of field, how long they write, and the sites they open first at each
 * time of day. */
export type Style={tone?:string;length?:string;greetings:string[];signOffs:string[];phrases:string[];words?:number;samples?:number};
export type Fact={text:string;kind:string;count:number;last:number};
export type Profile={who?:string;work:string[];people:string[];places:string[];tools:string[];style:Record<string,Style>;facts:Fact[];routines:string[];updatedAt:number;cursor:number;
 /** The version of the rules the profile was last checked against (PROFILE_RULES): an older one is checked again. */rules?:number};
/** Raised when the profile's rules change: Oct 27, what someone reads stopped being taken for who they are. */
export const PROFILE_RULES=3;
export const emptyProfile=():Profile=>({work:[],people:[],places:[],tools:[],style:{},facts:[],routines:[],updatedAt:0,cursor:0});
export type Op={op:'set'|'add'|'remove';path:string;value?:string};
const lists=['work','people','places','tools','routines'] as const;
/** Applies the model's changes: "who" is set; a list gets an item added or removed (by its words, case aside); a style's
 * tone or length is set ("style.<context>.tone"). Anything else is ignored. */
export function applyOps(profile:Profile,ops:Op[]):Profile{
 const next:Profile=structuredClone(profile);
 for(const o of ops??[]){
  const value=typeof o?.value==='string'?o.value.trim().slice(0,300):'';
  if(o?.path==='who'&&o.op==='set'&&value){next.who=value;continue;}
  const list=lists.find(l=>l===o?.path);
  if(list){const items=next[list],at=items.findIndex(x=>x.toLowerCase()===value.toLowerCase());if(o.op==='remove'){if(at>=0)items.splice(at,1);}else if(value&&at<0)items.push(value);next[list]=items.slice(-30);continue;}
  const m=/^style\.(.+)\.(tone|length)$/.exec(o?.path??'');
  if(m&&o.op==='set'&&value){const s=next.style[m[1]]??={greetings:[],signOffs:[],phrases:[]};s[m[2] as 'tone'|'length']=value;}
 }
 return next;
}
const emailRe=/[\w.+-]+@[\w-]+\.[\w.-]+/g,urlRe=/https?:\/\/[^\s)>\]]+/g,phoneRe=/(?:\+?\d[\s.-]?)?\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}/g,addressRe=/\b\d{1,5}\s+[A-Z][\w.]*(?:\s+[A-Z][\w.]*){0,3}\s+(?:St|Street|Ave|Avenue|Rd|Road|Blvd|Dr|Drive|Ln|Lane|Way|Ct|Court|Pl|Place)\b\.?(?:,\s*[A-Z][a-z]+(?:\s[A-Z][a-z]+)*)?/g;
const availabilityRe=/\b(?:I'?m (?:free|available)|works for me|how about)\b[^.!?\n]{4,80}/gi;
/** What they type again and again (three times or more): addresses, links, emails, phone numbers, when they are free. */
export function recurringFacts(writing:{text:string;at:number}[],min=3):Fact[]{
 const seen=new Map<string,Fact>();
 const note=(text:string,kind:string,at:number)=>{const key=kind+'|'+text.toLowerCase();const f=seen.get(key)??{text,kind,count:0,last:0};f.count++;f.last=Math.max(f.last,at);seen.set(key,f);};
 for(const w of writing){
  const once=new Set<string>();
  for(const [re,kind] of [[emailRe,'email'],[urlRe,'link'],[phoneRe,'phone'],[addressRe,'address'],[availabilityRe,'availability']] as const)
   for(const m of w.text.matchAll(re)){const text=m[0].replace(/[.,;:]+$/,'');if(!once.has(kind+text)){once.add(kind+text);note(text,kind,w.at);}}
 }
 return [...seen.values()].filter(f=>f.count>=min).sort((a,b)=>b.count-a.count).slice(0,40);
}
const top=(items:string[],n:number,min=2)=>{const c=new Map<string,number>();for(const i of items)if(i)c.set(i,(c.get(i)??0)+1);return [...c].filter(([,k])=>k>=min).sort((a,b)=>b[1]-a[1]).slice(0,n).map(([s])=>s);};
/** How they write in each kind of field ("email", "chat", "email on mail.google.com"): how many words, their openings and
 * closings, the phrases they use most. */
export function styleStats(writing:{text:string;intent:string;site:string}[]):Record<string,Style>{
 const groups=new Map<string,string[]>();
 for(const w of writing)for(const key of [w.intent,`${w.intent} on ${w.site}`])groups.set(key,[...(groups.get(key)??[]),w.text]);
 const out:Record<string,Style>={};
 for(const [key,texts] of groups){
  if(texts.length<3)continue;
  const lines=texts.map(t=>t.trim().split('\n').map(l=>l.trim()).filter(Boolean));
  const greetings=top(lines.map(l=>(l[0]??'').match(/^(hi|hey|hello|dear|good (morning|afternoon|evening)|thanks|yo)\b[^,!\n]{0,30}[,!]?/i)?.[0]??''),3);
  const signOffs=top(lines.map(l=>l.length>1&&(l.at(-1)??'').length<=40?l.slice(-2).join(' / '):''),3);
  const grams:string[]=[];for(const t of texts){const words=t.toLowerCase().match(/[\p{L}']+/gu)??[];for(let i=0;i+2<words.length;i++)grams.push(words.slice(i,i+3).join(' '));}
  const words=Math.round(texts.reduce((n,t)=>n+(t.match(/\S+/g)?.length??0),0)/texts.length);
  out[key]={greetings,signOffs,phrases:top(grams,8,3),words,samples:texts.length};
 }
 return out;
}
/** The sites they open first in a part of the day, on most days it happens ("weekday mornings: opens mail.google.com,
 * then github.com"). */
export function routinesOf(visits:{site:string;in:number}[],minDays=4):string[]{
 const parts=[[5,12,'mornings'],[12,17,'afternoons'],[17,24,'evenings']] as const,byDay=new Map<string,{site:string;in:number}[]>();
 for(const v of visits){const d=new Date(v.in),part=parts.find(([a,b])=>d.getHours()>=a&&d.getHours()<b);if(!part)continue;const weekend=d.getDay()===0||d.getDay()===6;const key=`${d.toDateString()}|${weekend?'weekend':'weekday'} ${part[2]}`;byDay.set(key,[...(byDay.get(key)??[]),v]);}
 const firsts=new Map<string,string[][]>();
 for(const [key,list] of byDay){const sites:string[]=[];for(const v of list.sort((a,b)=>a.in-b.in))if(!sites.includes(v.site))sites.push(v.site);const part=key.split('|')[1];firsts.set(part,[...(firsts.get(part)??[]),sites.slice(0,3)]);}
 const out:string[]=[];
 for(const [part,days] of firsts){
  if(days.length<minDays)continue;
  const first=top(days.map(d=>d[0]),1,Math.ceil(days.length*0.5))[0];if(!first)continue;
  const second=top(days.filter(d=>d[0]===first).map(d=>d[1]??''),1,Math.ceil(days.length*0.4))[0];
  out.push(`${part[0].toUpperCase()}${part.slice(1)}: opens ${first}${second?`, then ${second}`:''}`);
 }
 return out;
}
