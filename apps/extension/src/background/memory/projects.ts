import {offscreen} from '../offscreen';
import {model} from '../model';
import {add,allProjects,removeProject,visitsBy,recent,putSealed,getSealed,type Project} from '../db';
import {config,forgetConfig,type Calibration} from './config';
import {load,changed,type LiveVisit} from './live';
import {choose,moved,unit,cosine,histogram,joinBar} from '../../shared/projects-core';
import {loadSettings} from '../../shared/settings';
import {PROJECT_NOTE_SYSTEM} from '../../shared/prompts';
import {textOf} from '../../shared/gateway';
/** Projects: the threads of work visits belong to (a trip being planned, a bug being fixed, a course). A visit is put in
 * one as it begins: by what its title means (embedded on this computer) against each project's centre, helped by the
 * chain it came along and the site; pages that only lead somewhere (search, an inbox) join only through their chain. A
 * new thread starts as a candidate and becomes a project once it has a few visits over a few minutes (candidates that
 * never do are dropped after a day). Each project keeps a short rolling note (goal, where they left off, what is open,
 * what was decided), rewritten by Haiku from the old note and what happened since, when enough happened or when the
 * user moves to other work; never twice for the same input. The join threshold is learned from this computer's own
 * history (calibrate). */
let projects:Map<string,Project>|undefined,loading:Promise<Map<string,Project>>|undefined;
export async function all():Promise<Map<string,Project>>{
 if(projects)return projects;
 return loading??=allProjects().catch(()=>[] as Project[]).then(list=>projects=new Map(list.map(p=>[p.id,p]))).finally(()=>{loading=undefined;});
}
export const forgetProjects=()=>{projects=undefined;};
async function vectors(texts:string[]):Promise<number[][]>{
 const out:number[][]=[];
 for(let i=0;i<texts.length;i+=64)out.push(...(await offscreen<{vectors:number[][]}>({type:'embed',texts:texts.slice(i,i+64)})).vectors.map(unit));
 return out;
}
/** A visit as words: its title, and what was read on it most. */
export const gistOf=(v:{title:string;seen?:Record<string,number>})=>`${v.title}\n${Object.entries(v.seen??{}).sort((a,b)=>b[1]-a[1]).slice(0,2).map(([t])=>t).join(' ')}`.trim().slice(0,600);
/** Pages that only lead somewhere (search, an inbox), and pages whose title says too little to place them, join only
 * through their chain. */
const leadsOn=(v:LiveVisit)=>['results','search','inbox'].includes(v.kind)||v.title.length<12&&!Object.keys(v.seen).length;
/** The project of the visit a visit came from (the page before it in the tab, or the one in the tab that opened it). */
async function chainOf(v:LiveVisit):Promise<string|undefined>{
 if(v.from===undefined)return;
 const s=await load(),cfg=(await config()).projects;
 for(const t of Object.values(s.tabs))for(const w of t.visits)if(w.id===v.from&&v.in-(w.out??v.in)<cfg.chainWindowMs)return w.project;
}
/** Puts a visit in a project (or starts one) as it begins. */
export async function assign(tab:number,v:LiveVisit){
 const cfg=(await config()).projects,list=await all(),chain=await chainOf(v),now=Date.now();
 const left=(await load()).tabs[tab]?.visits.filter(w=>w!==v).at(-1)?.project;
 let id:string|undefined;let gist:number[]|undefined;
 if(leadsOn(v))id=chain;
 else{
  gist=(await vectors([gistOf(v)]).catch(()=>[]))[0];
  id=choose({gist,site:v.site,chain,projects:[...list.values()],join:cfg.join,chainBonus:cfg.chainBonus,siteBonus:cfg.siteBonus}).id;
  if(!id&&gist){const p:Project={id:'p'+crypto.randomUUID().replace(/-/g,'').slice(0,12),name:(v.title||v.site).slice(0,60),sites:[],firstAt:now,lastAt:now,visits:0,activeMs:0,candidate:true};list.set(p.id,p);id=p.id;}
 }
 const p=id?list.get(id):undefined;if(!p)return;
 if(gist)p.centroid=moved(p.centroid,gist,p.visits);
 p.visits++;p.lastAt=now;if(!p.sites.includes(v.site))p.sites=[...p.sites,v.site].slice(-12);
 if(p.candidate&&p.visits>=cfg.promoteVisits&&now-p.firstAt>=cfg.promoteMs)p.candidate=false;
 v.project=p.id;changed();
 await add('projects',p).catch(()=>{});
 // Moving to other work is a moment to bring the note of what was left up to date.
 if(left&&left!==p.id)void maybeNote(left,true);
}
/** A visit in a project ended: its time counts, and the note is rewritten when enough happened since the last one. */
export async function visitEnded(v:LiveVisit){
 if(!v.project)return;const p=(await all()).get(v.project);if(!p)return;
 p.activeMs+=Math.round(v.activeMs);await add('projects',p).catch(()=>{});
 await maybeNote(p.id,false);
}
async function maybeNote(id:string,leaving:boolean){
 const p=(await all()).get(id),cfg=(await config()).projects;if(!p||p.candidate)return;
 if(Date.now()-(p.noteAt??0)<cfg.noteGapMs)return;
 const fresh=p.visits-(p.notedVisits??0),active=p.activeMs-(p.notedActiveMs??0);
 if(leaving?fresh>=1:fresh>=cfg.noteVisits||active>=cfg.noteActiveMs)await writeNote(p).catch(()=>{});
}
let writing:Promise<void>|undefined;
/** The note, rewritten from the old one and what happened since (one at a time). */
export function writeNote(p:Project):Promise<void>{
 return writing??=(async()=>{
  const s=await load(),visits=(await visitsBy({project:p.id},30).catch(()=>[])).reverse();
  const live=Object.values(s.tabs).flatMap(t=>t.visits).filter(v=>v.project===p.id);
  const read=live.flatMap(v=>Object.entries(v.seen).sort((a,b)=>b[1]-a[1]).slice(0,2).map(([t])=>`- on “${v.title.slice(0,80)}”: ${t.slice(0,240)}`)).slice(-8);
  const wrote=(await recent('writing',200).catch(()=>[])).filter(w=>w.project===p.id).slice(0,4).map(w=>`- in ${w.label||w.intent} on ${w.site}: ${w.text.replace(/\s+/g,' ').slice(0,300)}`);
  const ids=new Set(visits.map(v=>v.id));
  const clicked=(await recent('events',400).catch(()=>[])).filter(e=>e.visit!==undefined&&ids.has(e.visit)&&e.kind!=='switch').slice(0,12).reverse().map(e=>`- ${e.kind} “${e.name.slice(0,60)}” on ${e.site}`);
  const pages=visits.slice(-20).map(v=>`- ${new Date(v.in).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})} “${v.title.slice(0,100)}” (${v.site}, ${v.kind}${v.activeMs>=60_000?`, ${Math.round(v.activeMs/60_000)} min`:''})`);
  const input=[p.note?`<old_note name="${p.name}">\n${JSON.stringify(p.note)}\n</old_note>`:`<thread_so_far name="${p.name}"/>`,`<pages>\n${pages.join('\n')}\n</pages>`,read.length?`<what_they_read>\n${read.join('\n')}\n</what_they_read>`:'',wrote.length?`<what_they_wrote>\n${wrote.join('\n')}\n</what_they_wrote>`:'',clicked.length?`<what_they_did>\n${clicked.join('\n')}\n</what_they_did>`:''].filter(Boolean).join('\n');
  if(input===p.noteInput)return;
  const settings=await loadSettings();
  const {message}=await model({model:settings.models.notes,system:PROJECT_NOTE_SYSTEM,messages:[{role:'user',content:input}],max_tokens:400,purpose:'action',stream:false});
  const json=/\{[\s\S]*\}/.exec(textOf(message)??'')?.[0];if(!json)return;
  let note:any;try{note=JSON.parse(json);}catch{return;}
  const list=(x:unknown)=>Array.isArray(x)?x.map(String).map(s=>s.slice(0,160)).slice(0,4):[];
  Object.assign(p,{name:String(note.name||p.name).slice(0,60),note:{goal:String(note.goal??'').slice(0,240),leftOff:String(note.leftOff??'').slice(0,240),open:list(note.open),decisions:list(note.decisions)},noteAt:Date.now(),notedVisits:p.visits,notedActiveMs:p.activeMs,noteInput:input});
  await add('projects',p);
 })().finally(()=>{writing=undefined;});
}
/** Candidates that never became projects are dropped after a day. */
export async function tidyProjects(){
 const list=await all(),cut=Date.now()-86_400_000;
 for(const [id,p] of list)if(p.candidate&&p.lastAt<cut){list.delete(id);await removeProject(id).catch(()=>{});}
}

/** Learns the join threshold from this computer's visits: pages reached one from the other within half an hour (mostly
 * the same work) against pages on different sites on different days (mostly not), by what their titles mean. Kept sealed;
 * the debug view shows both histograms. */
export async function calibrate():Promise<Calibration|undefined>{
 const visits=(await recent('visits',4000)).filter(v=>v.title&&!['results','search','inbox'].includes(v.kind));
 const byId=new Map(visits.map(v=>[v.id,v])),same:[string,string][]=[],other:[string,string][]=[];
 // Titles that say little ("Sign in", "Home") or are the same everywhere would only add noise.
 const telling=(a:string,b:string)=>a!==b&&a.length>=12&&b.length>=12;
 for(const v of visits){const f=v.from!==undefined?byId.get(v.from):undefined;if(f&&telling(f.title,v.title)&&Math.abs(v.in-f.in)<30*60_000)same.push([f.title,v.title]);if(same.length>=200)break;}
 for(let i=0;i<visits.length*4&&other.length<200;i++){
  const a=visits[Math.floor(Math.random()*visits.length)],b=visits[Math.floor(Math.random()*visits.length)];
  if(a.site!==b.site&&telling(a.title,b.title)&&new Date(a.in).toDateString()!==new Date(b.in).toDateString())other.push([a.title,b.title]);
 }
 if(same.length<20||other.length<20)return;
 const titles=[...new Set([...same,...other].flat())],vecs=await vectors(titles),at=new Map(titles.map((t,i)=>[t,vecs[i]]));
 const sim=(pairs:[string,string][])=>pairs.map(([a,b])=>cosine(at.get(a)!,at.get(b)!));
 const s=sim(same),o=sim(other),t=joinBar(s,o);if(!Number.isFinite(t))return;
 const result:Calibration={at:Date.now(),pairs:{chain:s.length,random:o.length},chain:histogram(s),random:histogram(o),threshold:t};
 await putSealed('calibration',result);forgetConfig();return result;
}
/** Calibrates once there are enough visits, and again every few weeks. */
export async function calibrateWhenReady(){
 const had=await getSealed<Calibration>('calibration').catch(()=>undefined);
 if(had&&Date.now()-had.at<21*86_400_000)return had;
 return calibrate().catch(()=>undefined);
}
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name==='projects'){void tidyProjects();void calibrateWhenReady();}});
void chrome.alarms.get('projects').then(alarm=>{if(!alarm)void chrome.alarms.create('projects',{periodInMinutes:360,delayInMinutes:10});});
