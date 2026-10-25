import {existsSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {creatorStyle} from '@dream/config';
import {peekMeta} from '@dream/project-db';

/** What the composer's @ menu writes into a request (apps/desktop/src/renderer/components/chat/CreatorMentions.tsx):
 *  - @[name]: this project's media file of that name, or else another of the user's projects (the library list the app
 *    keeps, DREAM_PROJECT_LIBRARY);
 *  - @handle: a creator whose style the request asks for.
 * A message's context says what each reference is, already resolved, so the agent never guesses what "@[Vietnam trip]"
 * means. Other projects are read from their edit document (Workspace/project.json), never their databases, so a project
 * open in another window is not touched. */
export type Mention={text:string;kind:'media';assetId:string;filename:string}|{text:string;kind:'project';project:string}|{text:string;kind:'creator';handle:string;styleGuide:boolean}|{text:string;kind:'unknown'};
type Library={id:string;name:string;folder:string;updatedAt:string;durationSec?:number;archived?:boolean};

export function projectLibrary(file=process.env.DREAM_PROJECT_LIBRARY):Library[]{
 if(!file||!existsSync(file))return[];
 try{return(JSON.parse(readFileSync(file,'utf8')) as Library[]).filter(p=>p&&typeof p.folder==='string'&&typeof p.name==='string');}catch{return[];}
}
const same=(a:string,b:string)=>resolve(a).toLowerCase()===resolve(b).toLowerCase();
/** The user's other projects, newest first. */
export function otherProjects(currentFolder:string,library=projectLibrary()){
 const seen=new Set<string>();
 return library.filter(p=>!p.archived&&!same(p.folder,currentFolder)&&existsSync(join(p.folder,'Workspace'))).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)).filter(p=>{const key=resolve(p.folder).toLowerCase();if(seen.has(key))return false;seen.add(key);return true;});
}
export function findProject(name:string,projects:Library[]){
 const n=name.trim().toLowerCase();
 return projects.find(p=>p.name.toLowerCase()===n)??projects.find(p=>p.name.toLowerCase().startsWith(n))??projects.find(p=>p.name.toLowerCase().includes(n));
}

export function resolveMentions(text:string,assets:{id:string;filename:string}[],currentFolder:string,library=projectLibrary()):Mention[]{
 const found:Mention[]=[],seen=new Set<string>();
 for(const m of text.matchAll(/@\[([^\]\n]{1,120})\]/g)){
  const name=m[1].trim();if(seen.has(m[0]))continue;seen.add(m[0]);
  const asset=assets.find(a=>a.filename.toLowerCase()===name.toLowerCase());
  if(asset){found.push({text:m[0],kind:'media',assetId:asset.id,filename:asset.filename});continue;}
  const project=findProject(name,otherProjects(currentFolder,library));
  found.push(project?{text:m[0],kind:'project',project:project.name}:{text:m[0],kind:'unknown'});
 }
 for(const m of text.matchAll(/(^|[\s("'])@([A-Za-z0-9_.-]{2,40})(?![\w[])/g)){
  const handle=m[2].replace(/[.]+$/,'');if(seen.has('@'+handle.toLowerCase()))continue;seen.add('@'+handle.toLowerCase());
  found.push({text:'@'+handle,kind:'creator',handle,styleGuide:!!creatorStyle(handle)});
 }
 return found;
}

// ---- Past projects -------------------------------------------------------------------------------------------------

const median=(values:number[])=>{if(!values.length)return undefined;const s=[...values].sort((a,b)=>a-b);return s[Math.floor(s.length/2)];};
const round=(n:number|undefined,digits=2)=>n===undefined?undefined:Math.round(n*10**digits)/10**digits;
const count=<T,>(values:T[])=>[...values.reduce((m,v)=>m.set(v,(m.get(v)??0)+1),new Map<T,number>())].sort((a,b)=>b[1]-a[1]);
const short=(value:unknown,max=220)=>{const text=JSON.stringify(value);return text.length>max?text.slice(0,max-1)+'…':text;};

/** A published edit in the editor's own terms: format, pacing, color, framing, transitions, captions, titles and scenes,
 * sound. These are the values to copy for "make it look like that one". */
export function styleSummary(document:any,assets:{id:string;filename:string;scene?:unknown}[]=[]){
 const t=document?.timeline??document,spine:any[]=t?.spine??[],attached:any[]=t?.attached??[],music:any[]=t?.music??[];
 const lengths=spine.map(c=>(c.holdSec??(c.srcOut-c.srcIn)/(c.speed||1))).filter(n=>Number.isFinite(n)&&n>0);
 const graded=spine.map(c=>c.framing??{}).filter(f=>['exposure','contrast','saturation','temperature','tint','fade','filter'].some(k=>f[k]!==undefined));
 const avg=(key:string)=>{const v=graded.map(f=>f[key]).filter((n:unknown):n is number=>typeof n==='number');return v.length?round(v.reduce((a,b)=>a+b,0)/v.length):undefined;};
 const filters=count(graded.map(f=>f.filter).filter(Boolean)).map(([id,n])=>{const k=graded.filter(f=>f.filter===id).map(f=>f.filterIntensity).filter((x:unknown)=>typeof x==='number');return`${id} on ${n} clips${k.length?` (intensity about ${round(median(k))})`:''}`;});
 const transitions=spine.map(c=>c.transitionIn).filter(Boolean);
 const name=(id?:string)=>assets.find(a=>a.id===id)?.filename;
 const overlays=attached.filter(i=>i.type==='overlay'),sounds=attached.filter(i=>i.type==='sfx');
 const byComponent=count(overlays.map(i=>i.source?name(i.source.assetId)??i.component:i.component)).slice(0,8).map(([component,n])=>{const first=overlays.find(i=>(i.source?name(i.source.assetId)??i.component:i.component)===component);return{component,count:n,example:first?.params&&Object.keys(first.params).length?short(first.params):undefined};});
 const durationSec=round(lengths.reduce((a,b)=>a+b,0),1);
 return{
  format:t?.settings?`${t.settings.width}x${t.settings.height}, ${t.settings.fps} fps`:undefined,
  durationSec,
  pacing:{mainTrackClips:spine.length,medianClipSec:round(median(lengths),1),shortestSec:round(lengths.length?Math.min(...lengths):undefined,1),longestSec:round(lengths.length?Math.max(...lengths):undefined,1),speedChanges:spine.filter(c=>c.speed&&c.speed!==1).length},
  color:graded.length?{gradedClips:`${graded.length} of ${spine.length}`,filters,average:{exposure:avg('exposure'),contrast:avg('contrast'),saturation:avg('saturation'),temperature:avg('temperature'),tint:avg('tint'),fade:avg('fade')}}:'no grading',
  framing:{punchIns:spine.filter(c=>(c.framing?.scale??1)>1.05).length,keyframedClips:spine.filter(c=>c.keyframes?.length).length,modes:count(spine.map(c=>c.framing?.mode??'fit')).map(([m,n])=>`${m} ${n}`)},
  transitions:transitions.length?{used:count(transitions.map(x=>x.type)).map(([type,n])=>`${type} ${n}`),medianSec:round(median(transitions.map(x=>x.durationSec)))}:'hard cuts only',
  captions:t?.captions?{style:t.captions.style,params:short(t.captions.params,300)}:'none',
  titlesAndScenes:byComponent,
  sound:{music:music.map(m=>({file:name(m.assetId)??m.assetId,gainDb:m.gainDb,duckUnderSpeechDb:m.duckUnderSpeechDb})).slice(0,6),soundEffects:sounds.length,effects:count(sounds.map(i=>i.params?.preset??(i.source?name(i.source.assetId):i.component)).filter(Boolean)).slice(0,6).map(([s,n])=>`${s} ${n}`)},
 };
}

function readJson(path:string){try{return JSON.parse(readFileSync(path,'utf8'));}catch{return undefined;}}
const workspaceOf=(p:Library)=>join(p.folder,'Workspace');
function publishedEdit(p:Library){const w=workspaceOf(p);return readJson(join(w,'project.json'))??readJson(join(w,'context','published-project.json'));}
function assetsOf(p:Library){const w=workspaceOf(p);return readJson(join(w,'footage','assets.json'))??readJson(join(w,'context','assets.json'))??[];}

/** What each @ reference in a message is, as lines for the message's context: the media file it names, how another of the
 * user's projects was edited (its format, pacing, colour, captions, titles and sound, the values to copy for "make it look
 * like that one"), or Gumbo's style guide for a creator. */
export function mentionLines(text:string,assets:{id:string;filename:string}[],currentFolder:string,library=projectLibrary()):string[]{
 return resolveMentions(text,assets,currentFolder,library).map(m=>{
  if(m.kind==='media')return`${m.text} is the source ${m.assetId} "${m.filename}".`;
  if(m.kind==='project'){const p=findProject(m.project,otherProjects(currentFolder,library)),doc=p&&publishedEdit(p);
   if(!doc)return`${m.text} is the user's project "${m.project}", which has no edit yet.`;
   const style=JSON.stringify(styleSummary(doc,assetsOf(p!)));return`${m.text} is the user's project "${m.project}". How it was edited: ${style.length>2400?style.slice(0,2399)+'…':style}`;}
  if(m.kind==='creator'){const guide=creatorStyle(m.handle);return guide?`${m.text} is ${guide.name}. Gumbo's guide to their editing style: ${guide.recipe} Follow the style; never use their footage, logos, music or thumbnails.`:`${m.text} is a creator whose style the user wants. Learn it with web before editing (search "${m.handle} editing style"); never use their footage, logos, music or thumbnails.`;}
  return`${m.text}: no media file or project has this name; ask which one they mean if it matters.`;
 });
}

// ---- The user's style ------------------------------------------------------------------------------------------------

/** The section of a project memory file the user's taste lives in. */
const preferencesOf=(memory:string)=>{const match=/^##\s*Preferences\s*\n([\s\S]*?)(?=^##\s|(?![\s\S]))/m.exec(memory);return match?.[1].replace(/\s+/g,' ').trim()||undefined;};
/** What the user wanted in their other projects (the preferences in each project's GUMBO.md, or an older project's notes),
 * for the start of every conversation, so lasting taste (caption looks, formats, pacing, what they dislike) carries into a
 * new project without being said again. Test copies (EVAL ...) are left out; as many of the newest projects with something
 * to say as the plan remembers (Free 1, Pro 6, Max 20, Max 20x up to 40), about 300 characters each. */
export function styleFromOtherProjects(currentFolder:string,library=projectLibrary(),memory=process.env.DREAM_STYLE_MEMORY):string[]{
 // How many projects the plan remembers (DREAM_STYLE_MEMORY from the app: a number, or all); one before the plan is known.
 const most=memory==='all'?40:Math.max(0,Math.min(40,Number(memory)||1)),found:string[]=[];
 for(const p of otherProjects(currentFolder,library)){
  if(found.length>=most)break;if(/^eval\b/i.test(p.name))continue;
  let notes:string|undefined;try{notes=preferencesOf(readFileSync(join(workspaceOf(p),'GUMBO.md'),'utf8'));}catch{}
  notes??=peekMeta(p.folder,['preferences']).preferences?.replace(/\s+/g,' ').trim();
  if(notes)found.push(`- ${p.name} (${p.updatedAt.slice(0,10)}): ${notes.slice(0,300)}`);
 }
 return found;
}
