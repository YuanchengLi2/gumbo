import {model} from '../model';
import {recent,getSealed,putSealed} from '../db';
import {config} from './config';
import {all as allProjects} from './projects';
import {emptyProfile,applyOps,recurringFacts,styleStats,routinesOf,PROFILE_RULES,type Profile,type Op} from '../../shared/profile-core';
import {loadSettings} from '../../shared/settings';
import {PROFILE_SYSTEM} from '../../shared/prompts';
import {textOf} from '../../shared/gateway';
/** The profile: who the user is, the long-term layer under each project's note and the session. Two parts:
 * - learned on this computer, with no model, each time it is updated: the facts they type again and again (an address,
 *   a link they share, when they are free), how they write in each kind of field (length, openings, closings, phrases)
 *   and their routines (what they open first at each time of day);
 * - kept by Haiku: who they are, their work, the people, places and tools that recur, and the tone of each kind of
 *   writing, changed a little at a time from the writing that is new since the last update (never written from
 *   scratch).
 * Updated when twenty new pieces of writing came in, once a day, and when the computer goes idle with something new.
 * Sealed like the rest of memory. The facts the user gave in settings always win over what is learned. */
let cached:Profile|undefined,newWritings=0,updating:Promise<Profile>|undefined;
export async function profile():Promise<Profile>{return cached??=(await getSealed<Profile>('profile').catch(()=>undefined))??emptyProfile();}
export const forgetProfile=()=>{cached=undefined;};
/** A new piece of writing came in (capture.ts): enough of them is a reason to update. */
export async function noteWriting(){newWritings++;if(newWritings>=(await config()).profile.everyWritings){newWritings=0;void updateProfile();}}
export function updateProfile({llm=true}:{llm?:boolean}={}):Promise<Profile>{
 return updating??=(async()=>{
  const base=await profile(),now=Date.now();
  const [writing,visits,projects]=await Promise.all([recent('writing',2000).catch(()=>[]),recent('visits',6000,now-30*86_400_000).catch(()=>[]),allProjects()]);
  let next:Profile={...structuredClone(base),facts:recurringFacts(writing),routines:routinesOf(visits.filter(v=>v.source==='browser'||v.source==='import'))};
  // The numbers are learned again; the tone and length the model gave a context are kept.
  const stats=styleStats(writing);next.style=Object.fromEntries(Object.entries(stats).map(([k,s])=>[k,{...s,tone:base.style[k]?.tone,length:base.style[k]?.length}]));
  // A profile made under older rules is checked again against their latest writing, new or not.
  const revise=(base.rules??0)<PROFILE_RULES&&(!!base.who||base.work.length>0);
  // Who they are and their work are learned again from nothing: a check that may only add kept a wrong role (a student
  // taken for the teacher of the class pages they read).
  if(revise){base.who=undefined;base.work=[];}
  const fresh=revise?writing.slice(0,30):writing.filter(w=>(w.id??0)>base.cursor).slice(0,30);
  if(llm&&(fresh.length>=3||revise)){
   const sites=new Map<string,number>();for(const v of visits)sites.set(v.site,(sites.get(v.site)??0)+Math.max(1,v.activeMs/60_000));
   const topSites=[...sites].sort((a,b)=>b[1]-a[1]).slice(0,15).map(([s])=>s);
   const current={who:base.who,work:base.work,people:base.people,places:base.places,tools:base.tools,style:Object.fromEntries(Object.entries(base.style).filter(([,s])=>s.tone||s.length).map(([k,s])=>[k,{tone:s.tone,length:s.length}]))};
   const input=[`<profile>\n${JSON.stringify(current)}\n</profile>`,`<new_writing>\n${fresh.map(w=>`[${w.intent} on ${w.site}${w.label?`, ${w.label.slice(0,40)}`:''}] ${w.text.replace(/\s+/g,' ').slice(0,300)}`).join('\n')}\n</new_writing>`,`<sites_they_use_most>\n${topSites.join(', ')}\n</sites_they_use_most>`,`<their_threads>\n${[...projects.values()].filter(p=>!p.candidate).sort((a,b)=>b.lastAt-a.lastAt).slice(0,8).map(p=>`- ${p.name}`).join('\n')}\n</their_threads>`,`Contexts with style: ${Object.keys(stats).slice(0,12).join('; ')}`].join('\n');
   try{
    const settings=await loadSettings();
    const {message}=await model({model:settings.models.notes,system:PROFILE_SYSTEM,messages:[{role:'user',content:input}],max_tokens:500,purpose:'action',stream:false});
    const json=/\[[\s\S]*\]/.exec(textOf(message)??'')?.[0];
    if(json){const ops=JSON.parse(json) as Op[];next=applyOps(next,Array.isArray(ops)?ops:[]);next.rules=PROFILE_RULES;}
    next.cursor=Math.max(base.cursor,...fresh.map(w=>w.id??0));
   }catch{}
  }
  next.updatedAt=now;cached=next;await putSealed('profile',next).catch(()=>{});return next;
 })().finally(()=>{updating=undefined;});
}
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name==='profile')void updateProfile();});
// A profile made under older rules is put right soon after the worker starts.
setTimeout(()=>void profile().then(p=>{if((p.rules??0)<PROFILE_RULES&&(p.who||p.work.length))void updateProfile();}).catch(()=>{}),15_000);
void chrome.alarms.get('profile').then(alarm=>{if(!alarm)void chrome.alarms.create('profile',{periodInMinutes:24*60,delayInMinutes:30});});
chrome.idle.onStateChanged.addListener(state=>{if(state==='idle'&&newWritings>=3){newWritings=0;void updateProfile();}});
