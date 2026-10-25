import {existsSync,mkdirSync,readdirSync,rmSync,readFileSync} from 'node:fs';
import {join,relative,basename,dirname} from 'node:path';
import type {ProjectDB} from '@dream/project-db';
import type {FootageIndex} from '@dream/footage';
import {captureOrder} from '@dream/agent';
import {replaceFileSync,digest} from '../../../packages/project-db/src/workspace-store';
import {ShotIndexer,type ShotIndex} from './shot-index';
import {SoundIndexer,soundText,beatsJson,lineSpeaker,type SoundIndex} from './sound-index';

/** The footage as files, so the agent reads and searches it the way a programmer reads and searches code. Every source gets
 * a folder under footage/:
 *  - overview.md: what it is, who is in it, its scenes with times and its notable moments (written by a small model from
 *    the transcript and the shot list, once both are in);
 *  - transcript.txt: what is said, one sentence a line with its source times (and who says it, when there are voices
 *    to tell apart);
 *  - words.json: every word with its times, for code that computes cuts;
 *  - shots.txt: every shot with what is visible and what was measured (camera, light, sharpness);
 *  - sound.txt: what kind of sound is where, notable sounds (laughter, applause, a bang…), the loudest moments, the voices
 *    and the music's tempo (sound-index.ts), with beats.json holding every beat for code.
 * footage/INDEX.md lists every source with its length, a one-line summary and how far its analysis has got, and
 * footage/assets.json gives code the facts and file paths. The same pipeline runs for a ten-second clip and a six-hour
 * recording; only the number of lines differs. The files follow the project: a transcript grows while it is heard. */

type Asset=FootageIndex['assets'][number];
type Word=FootageIndex['words'][number];
const r1=(n:number)=>(Math.round(n*10)/10).toFixed(1);
const clock=(sec:number)=>{const s=Math.max(0,Math.round(sec)),h=Math.floor(s/3600),m=Math.floor(s%3600/60),r=s%60;return h?`${h}:${String(m).padStart(2,'0')}:${String(r).padStart(2,'0')}`:`${m}:${String(r).padStart(2,'0')}`;};
const slug=(name:string)=>name.replace(/\.[^.]+$/,'').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu,'-').replace(/^-+|-+$/g,'').slice(0,40)||'source';
/** The folder of a source's files, relative to the workspace. */
export const footageFolder=(asset:Pick<Asset,'id'|'filename'>)=>`footage/${slug(asset.filename)}-${asset.id}`;
/** Sources the library describes: what the user brought in, not what code or generators made. */
export const described=(a:Asset)=>!a.scene&&!a.creation&&!a.generated;

/** Words grouped into sentences: a line ends at sentence punctuation, a pause, a change of speaker, or when it grows long. */
export function sentences(words:(Pick<Word,'text'|'start'|'end'>&{speaker?:string})[]){
 const lines:{start:number;end:number;text:string;speaker?:string}[]=[];let current:typeof lines[number]|undefined;
 for(const w of [...words].sort((a,b)=>a.start-b.start)){
  const text=w.text.trim();if(!text)continue;
  const speaker=w.speaker&&w.speaker!=='unknown'?w.speaker:undefined;
  if(current){
   const gap=w.start-current.end,ended=/[.?!…]["'”’)\]]*$/.test(current.text);
   if(gap>1.2||speaker&&current.speaker&&speaker!==current.speaker||current.text.length>180||ended&&(current.text.length>=24||gap>.35)){lines.push(current);current=undefined;}
  }
  if(!current)current={start:w.start,end:w.end,text,...(speaker?{speaker}:{})};else{current.end=Math.max(current.end,w.end);current.text+=' '+text;}
 }
 if(current)lines.push(current);
 return lines;
}
/** transcript.txt: a header that says what the file is and how complete, then "[start-end] sentence" in source seconds. */
export function transcriptText(asset:Pick<Asset,'id'|'filename'|'durationSec'|'hasAudio'>,words:(Pick<Word,'text'|'start'|'end'>&{speaker?:string})[],status:{state:'complete'|'running'|'waiting'|'failed'|'none';until?:number;error?:string;covered?:{start:number;end:number}[]},sound?:SoundIndex){
 const head=`# What is said in ${asset.filename} (${asset.id}, ${clock(asset.durationSec)} long). One sentence a line: [start-end] in source seconds.`;
 if(!asset.hasAudio)return`${head}\n(This source has no sound.)\n`;
 const note=status.state==='running'?`(Still being transcribed: heard without a gap up to ${r1(status.until??0)} s of ${r1(asset.durationSec)} s. More lines arrive as it continues.)`
  :status.state==='waiting'?'(Not transcribed yet; lines arrive here as it is heard.)'
  :status.state==='failed'?`(Transcription failed${status.error?`: ${status.error.slice(0,200)}`:''}.)`:'';
 const lines=spoken(words,sound).map(l=>({at:l.start,text:`[${r1(l.start)}-${r1(l.end)}] ${l.speaker?`${l.speaker}: `:''}${l.text}`}));
 // While parts are heard out of order, a stretch not heard yet is marked, so it never reads as silence.
 if(status.state==='running'){
  const spans:[number,number][]=[];for(const r of [...status.covered??[]].sort((a,b)=>a.start-b.start)){const last=spans.at(-1);if(last&&r.start<=last[1]+.01)last[1]=Math.max(last[1],r.end);else spans.push([r.start,r.end]);}
  let from=0;for(const [start,end] of [...spans,[asset.durationSec,asset.durationSec] as [number,number]]){if(start>from+.05)lines.push({at:from,text:`(${r1(from)}-${r1(start)} s: not heard yet)`});from=Math.max(from,end);}
  lines.sort((a,b)=>a.at-b.at);
 }
 return[head,...(note?[note]:[]),...(lines.length?lines.map(l=>l.text):status.state==='complete'?['(No speech was heard.)']:[])].join('\n')+'\n';
}
/** The transcript's sentences, each with the voice that covers most of it when the sound analysis heard more than one. */
function spoken(words:(Pick<Word,'text'|'start'|'end'>&{speaker?:string})[],sound?:SoundIndex){
 const lines=sentences(words);if(!sound||sound.speakers.count<2)return lines;
 return lines.map(l=>{const speaker=lineSpeaker(sound.speakers.turns,l.start,l.end);return speaker?{...l,speaker}:l;});
}
/** shots.txt: every shot of the footage index with what is visible, its tags and its measured facts. */
export function shotsText(asset:Pick<Asset,'id'|'filename'|'durationSec'|'kind'>,index:ShotIndex|undefined,status:string){
 const head=`# Shots in ${asset.filename} (${asset.id}). One shot a line (long takes in parts of up to six seconds): [start-end] in source seconds | what happens | on screen: text shown, when there is any | tags | measured facts (camera: steady, handheld, shaky, pans; light; soft = out of focus; loudness). Descriptions come from a small vision model and can be wrong; look at frames to be sure.`;
 if(!index)return`${head}\n(${status==='not indexed'?'Not analysed yet':status}: shots arrive here when the analysis finishes.)\n`;
 const lines=index.shots.map(s=>`${asset.kind==='image'?'[image]':`[${r1(s.start)}-${r1(s.end)}]`} ${s.what??'(not described yet)'}${s.text?` | on screen: "${s.text}"`:''} | ${(s.tags??[]).join(', ')||'-'} | ${s.labels.join(', ')||'-'}`);
 return[head,...(index.describeError&&index.shots.some(s=>!s.what)?[`(Describing some shots failed: ${index.describeError.slice(0,160)}.)`]:[]),...lines].join('\n')+'\n';
}

/** The system prompt for writing a source's overview, and for the notes on each part of a long one. */
export const overviewSystem=`You write the overview of one source video for a video editor who will cut it. You get its transcript (one sentence a line, [start-end] in source seconds; "A:", "B:"… mark different voices), its shot list (what is visible in each shot) and what its sound analysis heard (music, laughter, applause, bangs, loud moments). Reply in Markdown, exactly in this shape, and nothing else:

<one paragraph of 2-4 sentences: what this is (a vlog, an interview, a TV episode, gameplay, a lecture...), what happens, and how it ends>

## People
- <name or description>: <who they are, how to recognise them, what they do here; which voice letter is theirs, when the transcript has letters>

## Scenes
- <start>-<end> s: <what happens, in one or two sentences>

## Moments
- <time> s: <a moment an editor would want: a strong line (quote it briefly), a reaction, a reveal, a joke, an action, a problem in the footage>

Times are source seconds as in the transcript. Scenes cover the whole source in order with no gaps; a scene is a stretch with one place, one situation or one topic (usually 20 seconds to a few minutes). List the 5-15 best moments; laughter, applause, a crowd going up or a sudden loud moment often marks one. Write only what the transcript, shots and sounds show; never invent names or events. If there is no speech, work from the shots and sounds.`;
const partSystem=`You take notes on one part of a longer source video for a video editor. You get that part's transcript (one sentence a line, [start-end] in source seconds; "A:", "B:"… mark different voices), shot list and what its sound analysis heard. Reply in Markdown with two lists and nothing else:
## Scenes
- <start>-<end> s: <what happens>
## Moments
- <time> s: <a strong line (quote briefly), a reaction, a reveal, a joke, an action or a problem>
Also name the people who appear, how to recognise them and their voice letter in one line starting "People:". Times are source seconds. Never invent anything.`;
const combineSystem=overviewSystem+`\n\nYou get notes on each part of the source in order instead of the full transcript. Merge them into one overview of the whole source: keep every scene in order (merge only when two notes describe the same stretch), and choose the best moments across the whole source.`;
/** How much text one call reads: a source longer than this is read in parts of about five minutes, then combined. */
const ONE_CALL=48_000,PART_SEC=300;
/** A clip shorter than this gets no written overview: its transcript and shot list already say everything. */
const OVERVIEW_MIN_SEC=45;
const wantsOverview=(asset:Pick<Asset,'kind'|'durationSec'>)=>(asset.kind==='video'||asset.kind==='audio')&&asset.durationSec>=OVERVIEW_MIN_SEC;

export type Overview={hash:string;text?:string;error?:string;at:string};
type Summarize=(system:string,text:string,signal:AbortSignal)=>Promise<string>;

export class FootageLibrary {
 private written=new Map<string,string>();private list='';private timer?:ReturnType<typeof setInterval>;private writing?:string;private controller=new AbortController();
 constructor(private db:ProjectDB,private root:string,private options:{shots?:ShotIndexer;sounds?:SoundIndexer;summarize?:Summarize}={}){}
 private write(path:string,text:string){const target=join(this.root,path);mkdirSync(dirname(target),{recursive:true});if(existsSync(target)&&readFileSync(target,'utf8')===text)return;replaceFileSync(target,text);}
 private job(assetId:string){return(this.db.db.prepare("SELECT status,error FROM jobs WHERE asset_id=? AND step='transcription'").get(assetId) as {status:string;error:string|null}|undefined);}
 /** How far from the start a source's speech is heard without a gap, in seconds. */
 private heardUntil(assetId:string){
  const ranges=[...(this.db.loadState<{ranges?:{start:number;end:number}[]}>('speech-coverage:'+assetId)?.ranges??[])].sort((a,b)=>a.start-b.start);
  let until=0;for(const r of ranges){if(r.start>until+.01)break;until=Math.max(until,r.end);}return until;
 }
 private transcriptState(asset:Asset):{state:'complete'|'running'|'waiting'|'failed'|'none';until?:number;error?:string;covered?:{start:number;end:number}[]}{
  if(!asset.hasAudio)return{state:'none'};const job=this.job(asset.id);
  if(job?.status==='complete')return{state:'complete'};if(job?.status==='failed')return{state:'failed',error:job.error??undefined};
  if(job?.status==='running')return{state:'running',until:this.heardUntil(asset.id),covered:this.db.loadState<{ranges?:{start:number;end:number}[]}>('speech-coverage:'+asset.id)?.ranges??[]};return{state:'waiting'};
 }
 private shotIndex(asset:Asset){return this.options.shots&&ShotIndexer.indexable(asset)?this.options.shots.saved(asset.id):undefined;}
 private shotStatus(asset:Asset){return this.options.shots&&ShotIndexer.indexable(asset)?this.options.shots.status(asset.id):'not analysed';}
 private soundIndex(asset:Asset){return this.options.sounds&&SoundIndexer.indexable(asset)?this.options.sounds.saved(asset.id):undefined;}
 private soundStatus(asset:Asset){return this.options.sounds&&SoundIndexer.indexable(asset)?this.options.sounds.status(asset.id):'not analysed';}
 overview(assetId:string){return this.db.loadState<Overview>('footage-overview:'+assetId);}
 /** Whether a source's transcript and shots are complete enough to write its overview from. */
 private ready(asset:Asset){
  if(asset.status==='failed'||asset.missing)return false;
  const speech=this.transcriptState(asset).state;if(speech==='running'||speech==='waiting')return false;
  if(this.options.shots&&ShotIndexer.indexable(asset)){const index=this.options.shots.saved(asset.id);if(!index||index.shots.some(s=>!s.what)&&!index.describeError)return false;}
  // The sound analysis too, unless it failed (it is quicker than describing the shots, so this rarely waits).
  if(this.options.sounds&&SoundIndexer.indexable(asset)&&!this.soundIndex(asset)&&!/failed/.test(this.soundStatus(asset)))return false;
  return wantsOverview(asset);
 }
 private material(asset:Asset){
  const sound=this.soundIndex(asset),words=asset.hasAudio?this.db.wordsOf(asset.id):[],lines=spoken(words,sound).map(l=>({at:l.start,text:`[${r1(l.start)}-${r1(l.end)}] ${l.speaker?l.speaker+': ':''}${l.text}`}));
  const shots=(this.shotIndex(asset)?.shots??[]).map(s=>({at:s.start,text:`[${r1(s.start)}-${r1(s.end)}] ${s.what??''}${s.tags?.length?` (${s.tags.join(', ')})`:''}`}));
  // What the sound adds to the words and pictures: music and other sound (not speech or silence), the events, the loud moments.
  const sounds=sound?[...sound.sections.filter(s=>s.kind!=='speech'&&s.kind!=='silence').map(s=>({at:s.start,text:`[${r1(s.start)}-${r1(s.end)}] ${s.kind}${s.label?` (${s.label})`:''}`})),
   ...sound.events.map(e=>({at:e.start,text:`[${r1(e.start)}-${r1(e.end)}] ${e.label}`})),...sound.loud.map(l=>({at:l.at,text:`[${r1(l.at)}] loud: ${l.rise} dB above around it`}))].sort((a,b)=>a.at-b.at):[];
  return{lines,shots,sounds,hash:digest(JSON.stringify([lines,shots,sounds]))};
 }
 private status(asset:Asset){
  const speech=this.transcriptState(asset),overview=this.overview(asset.id);
  const parts=[asset.hasAudio?`transcript ${speech.state==='running'?`being heard (to ${Math.round(speech.until??0)} s)`:speech.state==='waiting'?'not started':speech.state}`:'no sound',
   ...(this.options.shots&&ShotIndexer.indexable(asset)?[`shots: ${this.shotStatus(asset)}`]:[]),
   ...(this.options.sounds&&SoundIndexer.indexable(asset)?[`sound: ${this.soundStatus(asset)}`]:[]),
   ...(!wantsOverview(asset)?[]:[`overview ${overview?.text?'ready':this.writing===asset.id?'being written':overview?.error?`failed (${overview.error.slice(0,80)})`:'waits for the analysis'}`])];
  return parts.join('; ');
 }
 /** Writes every file whose inputs changed since it was last written. Cheap when nothing changed, so it can run every
  * few seconds: what each file is made from is compared by its saved record's key (a saved state's key changes with its
  * content), never by reading every word. */
 refresh(){
  const all=this.db.assets(),assets=captureOrder(all.filter(described)),seen=new Set<string>();
  const raw=this.db.db.prepare('SELECT value FROM meta WHERE key=?'),key=(name:string)=>(raw.get(name) as {value:string}|undefined)?.value??'';
  const jobs=new Map((this.db.db.prepare("SELECT asset_id AS id,status,error FROM jobs WHERE step='transcription'").all() as {id:string;status:string;error:string|null}[]).map(j=>[j.id,`${j.status}:${j.error??''}`]));
  let changed=false;
  for(const asset of assets){
   const folder=footageFolder(asset);seen.add(folder.split('/')[1]);
   const signature=JSON.stringify([asset.fingerprint,asset.durationSec,asset.status,asset.hasAudio,jobs.get(asset.id),key('speech-coverage:'+asset.id),key('shot-index:'+asset.id),key('sound-index:'+asset.id),this.options.sounds?.status(asset.id),key('footage-overview:'+asset.id),this.writing===asset.id]);
   if(this.written.get(asset.id)===signature&&existsSync(join(this.root,folder)))continue;
   changed=true;const speech=this.transcriptState(asset),index=this.shotIndex(asset),overview=this.overview(asset.id),sound=this.soundIndex(asset);
   // words.json holds a word a line, so it can be read in pages and grepped as well as parsed; with more than one voice,
   // their turns follow ([start, end, speaker]).
   if(asset.hasAudio){const words=this.db.wordsOf(asset.id),turns=sound&&sound.speakers.count>1?sound.speakers.turns:undefined;this.write(`${folder}/transcript.txt`,transcriptText(asset,words,speech,sound));this.write(`${folder}/words.json`,`{"assetId":${JSON.stringify(asset.id)},"format":"[start, end, word] in source seconds${turns?'; speakers: [start, end, voice] turns':''}","words":[\n${words.map(w=>JSON.stringify([Math.round(w.start*100)/100,Math.round(w.end*100)/100,w.text.trim()])).join(',\n')}\n]${turns?`,"speakers":[\n${turns.map(t=>JSON.stringify([t.start,t.end,t.speaker])).join(',\n')}\n]`:''}}\n`);}
   else this.write(`${folder}/transcript.txt`,transcriptText(asset,[],speech));
   if(asset.hasAudio&&asset.kind!=='image'){this.write(`${folder}/sound.txt`,soundText(asset,sound,this.soundStatus(asset)));if(sound?.music.length)this.write(`${folder}/beats.json`,beatsJson(asset,sound));}
   if(asset.kind!=='audio')this.write(`${folder}/shots.txt`,shotsText(asset,index,this.shotStatus(asset)));
   if(asset.kind!=='image'&&!wantsOverview(asset))this.write(`${folder}/overview.md`,`# ${asset.filename} (${asset.id}, ${clock(asset.durationSec)})\n\n(A short clip: transcript.txt and shots.txt say everything in it.)\n`);
   else if(asset.kind!=='image')this.write(`${folder}/overview.md`,overview?.text?`# ${asset.filename} (${asset.id}, ${clock(asset.durationSec)})\n\n${overview.text.trim()}\n`:`# ${asset.filename} (${asset.id}, ${clock(asset.durationSec)})\n\n(No overview yet: ${this.status(asset)}. Until it is written, read transcript.txt and shots.txt.)\n`);
   this.written.set(asset.id,signature);
  }
  const list=JSON.stringify(all.map(a=>[a.id,a.filename,a.originalPath,a.license]));
  if(!changed&&list===this.list&&existsSync(join(this.root,'footage','INDEX.md')))return;
  this.list=list;
  // Folders of sources no longer in the project go.
  if(existsSync(join(this.root,'footage')))for(const entry of readdirSync(join(this.root,'footage'),{withFileTypes:true}))if(entry.isDirectory()&&!seen.has(entry.name))rmSync(join(this.root,'footage',entry.name),{recursive:true,force:true});
  this.write('footage/INDEX.md',this.indexText(assets));
  this.write('footage/assets.json',JSON.stringify(captureOrder(all).map(a=>({id:a.id,filename:a.filename,kind:a.kind,durationSec:a.durationSec,hasAudio:a.hasAudio,capturedAt:a.capturedAt,width:a.width,height:a.height,fps:a.fps,...(described(a)?{folder:footageFolder(a)}:{scene:!!a.scene}),path:this.mediaPath(a),...(a.sequence?{sequence:{fps:a.sequence.fps,frameCount:a.sequence.frameCount,pattern:'%06d.png'}}:{}),...(a.license?{license:a.license.name,...(a.license.attribution?{credit:a.license.attribution}:{})}:{})})),null,2));
 }
 /** Where code finds a source's file: Media/ inside the project, or the copy commands make under Sources/. */
 mediaPath(a:Asset){return relative(this.db.folder,a.originalPath).replaceAll('\\','/').startsWith('Media/')?relative(this.root,a.originalPath).replaceAll('\\','/'):`../Sources/${a.id}/${basename(a.originalPath)}`;}
 /** One line per source for INDEX.md and for the agent's session start. */
 line(asset:Asset){
  const summary=this.overview(asset.id)?.text?.split('\n').find(l=>l.trim()&&!l.startsWith('#'))?.trim(),what=this.shotIndex(asset)?.shots[0]?.what;
  const facts=[`${asset.kind} ${asset.kind==='image'?'':clock(asset.durationSec)+` (${r1(asset.durationSec)} s)`}`.trim(),asset.width?`${asset.width}x${asset.height}`:'',asset.fps&&asset.kind==='video'?`${Math.round(asset.fps*100)/100} fps`:'',asset.kind==='video'?asset.hasAudio?'sound':'no sound':'',asset.capturedAt?`shot ${asset.capturedAt.slice(0,16).replace('T',' ')}`:'',asset.license?`licence ${asset.license.name}${asset.license.attribution?` (credit: ${asset.license.attribution})`:''}`:''].filter(Boolean).join(', ');
  const said=!summary&&!wantsOverview(asset)&&asset.hasAudio?sentences(this.db.wordsOf(asset.id).slice(0,60))[0]?.text:undefined;
  return`- ${asset.id} "${asset.filename}": ${facts}. ${footageFolder(asset)}/\n  ${summary?summary.slice(0,400):[what,said?`says "${said.slice(0,160)}"`:''].filter(Boolean).join('; ')||'(no summary yet)'}\n  Analysis: ${this.status(asset)}.`;
 }
 indexText(assets=captureOrder(this.db.assets().filter(described))){
  const made=this.db.assets().filter(a=>!described(a)).length;
  return['# Footage',`${assets.length} source${assets.length===1?'':'s'}, in the order they were shot. Each has a folder: overview.md (the story, people, scenes and moments with times), transcript.txt (what is said, a sentence a line, and by which voice), words.json (every word with times, for code), shots.txt (every shot) and sound.txt (music, laughter, applause, bangs, loud moments, voices, tempo; beats.json has every beat). Times are source seconds. footage/assets.json has paths and facts for code.${made?` ${made} more media item${made===1?' was':'s were'} made in this project (scenes, music, outputs).`:''}`,'',...(assets.length?assets.map(a=>this.line(a)):['(No footage yet. The user can drop files in, or you can find and import media.)']),''].join('\n');
 }

 /** Keeps the files current and writes overviews in the background, one source at a time, while the project is open. */
 watch(){if(this.timer)return;this.timer=setInterval(()=>{try{this.refresh();}catch{}void this.writeOverviews();},4000);void this.writeOverviews();}
 close(){if(this.timer)clearInterval(this.timer);this.timer=undefined;this.controller.abort();}
 private busy=false;private checked=new Map<string,string>();
 async writeOverviews(){
  if(this.busy||!this.options.summarize)return;this.busy=true;
  try{
   const raw=this.db.db.prepare('SELECT value FROM meta WHERE key=?'),key=(name:string)=>(raw.get(name) as {value:string}|undefined)?.value??'';
   for(const asset of captureOrder(this.db.assets().filter(described))){
    if(this.controller.signal.aborted)return;
    // Each source is looked at again only when its transcript or shots changed (or a failed overview is due a retry).
    const inputs=JSON.stringify([asset.fingerprint,this.job(asset.id)?.status,key('speech-coverage:'+asset.id),key('shot-index:'+asset.id),key('sound-index:'+asset.id),this.options.sounds?.status(asset.id)]),saved=this.overview(asset.id);
    if(this.checked.get(asset.id)===inputs&&(saved?.text||!saved||Date.now()-Date.parse(saved.at)<15*60_000))continue;
    this.checked.set(asset.id,inputs);
    if(!this.ready(asset))continue;
    const {lines,shots,sounds,hash}=this.material(asset);
    if(saved?.hash===hash&&(saved.text||Date.now()-Date.parse(saved.at)<15*60_000))continue;
    if(!lines.length&&!shots.length&&!sounds.length)continue;
    this.writing=asset.id;try{this.refresh();}catch{}
    let result:Overview;
    try{result={hash,text:await this.summarizeSource(asset,lines,shots,sounds),at:new Date().toISOString()};}
    catch(error){if(this.controller.signal.aborted)return;result={hash,error:(error as Error).message||String(error),at:new Date().toISOString()};}
    finally{this.writing=undefined;}
    this.db.saveState('footage-overview:'+asset.id,result);try{this.refresh();}catch{}
   }
  }finally{this.busy=false;}
 }
 /** One call for a source that fits; a long one is read in parts of about five minutes, then the notes are combined. */
 private async summarizeSource(asset:Asset,lines:{at:number;text:string}[],shots:{at:number;text:string}[],sounds:{at:number;text:string}[]){
  const signal=this.controller.signal,heading=`Source: ${asset.filename}, ${r1(asset.durationSec)} s long.`;
  const body=(from:number,to:number)=>{const within=(l:{at:number})=>l.at>=from&&l.at<to,said=lines.filter(within).map(l=>l.text),seen=shots.filter(within).map(s=>s.text),heard=sounds.filter(within).map(s=>s.text);return`Transcript:\n${said.join('\n')||'(no speech)'}\n\nShots:\n${seen.join('\n')||'(no shot list)'}${heard.length?`\n\nSounds:\n${heard.join('\n')}`:''}`;};
  const whole=body(0,Infinity);
  if(whole.length<=ONE_CALL)return this.options.summarize!(overviewSystem,`${heading}\n\n${whole}`,signal);
  // Parts are read four at a time, so a six-hour recording takes minutes, not an hour.
  const starts=Array.from({length:Math.ceil(asset.durationSec/PART_SEC)},(_,n)=>n*PART_SEC),parts:string[]=new Array(starts.length);let next=0;
  await Promise.all(Array.from({length:Math.min(4,starts.length)},async()=>{for(;;){const n=next++;if(n>=starts.length)return;const from=starts[n],to=Math.min(asset.durationSec+1,from+PART_SEC);
   parts[n]=`Part ${r1(from)}-${r1(Math.min(to,asset.durationSec))} s:\n`+await this.options.summarize!(partSystem,`${heading} This part: ${r1(from)}-${r1(to)} s.\n\n${body(from,to)}`,signal);}}));
  return this.options.summarize!(combineSystem,`${heading}\n\n${parts.join('\n\n')}`,signal);
 }
}
