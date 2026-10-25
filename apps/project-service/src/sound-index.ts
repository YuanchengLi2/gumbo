import {spawn} from 'node:child_process';
import {existsSync} from 'node:fs';
import type {ProjectDB} from '@dream/project-db';
import type {Asset} from '@dream/footage';
import {SOUND_ANALYSIS_VERSION,groupWords,speakerAt,type SoundAnalysis,type SpeakerTurn} from '@dream/sound';
import type {Analyse} from './sound-runtime';

/** The sound index: what each source sounds like (packages/sound), measured once on the user's computer in the background
 * after import, one source at a time. Saved per source as sound-index:<id> and read by the footage library, which writes
 * it out as sound.txt (and beats.json for music), and puts the speakers into transcript.txt. Nothing waits for it: until it
 * is in, the files say it is being analysed. */
export type SoundIndex=SoundAnalysis&{assetId:string;fingerprint:string;analysedAt:string};
type Failure={version:number;assetId:string;fingerprint:string;error:string;at:string};

/** A source's sound as 16 kHz mono samples, decoded by ffmpeg from the lossless copy import made (much quicker to read than
 * a large video) or else the original. */
async function* samples(ffmpeg:string,path:string,signal:AbortSignal){
 const child=spawn(ffmpeg,['-v','error','-i',path,'-vn','-ac','1','-ar','16000','-f','f32le','pipe:1'],{windowsHide:true,signal});
 let error='';child.stderr.on('data',chunk=>{error=(error+chunk.toString()).slice(-1000);});
 const closed=new Promise<number|null>((resolve,reject)=>{child.on('error',reject);child.on('close',resolve);});
 let rest:Buffer|undefined;
 for await(const chunk of child.stdout as AsyncIterable<Buffer>){
  const bytes=rest?.length?Buffer.concat([rest,chunk]):chunk,usable=bytes.length-bytes.length%4,out=new Float32Array(usable/4);
  new Uint8Array(out.buffer).set(bytes.subarray(0,usable));rest=bytes.subarray(usable);yield out;
 }
 const code=await closed;if(code!==0)throw new Error(`The sound could not be read for analysis${error?`: ${error.trim().slice(-300)}`:''}.`);
}

export class SoundIndexer{
 private running=new Map<string,Promise<SoundIndex|undefined>>();private controller=new AbortController();private queued:string[]=[];private draining=false;
 constructor(private db:ProjectDB,private ffmpeg:string,private analyse:Analyse){}
 static indexable(a:Asset){return a.hasAudio&&(a.kind==='video'||a.kind==='audio')&&!a.scene&&!a.sequence&&!a.creation&&!a.generated&&!a.missing&&a.status!=='failed';}
 /** Analyses these sources one after another in the background. */
 queue(ids:string[]){for(const id of ids)if(!this.queued.includes(id))this.queued.push(id);if(!this.draining)void this.drain();}
 private async drain(){this.draining=true;try{while(this.queued.length&&!this.controller.signal.aborted){const id=this.queued.shift()!;try{await this.ensure(id,this.controller.signal);}catch{}}}finally{this.draining=false;}}
 /** Sources with sound and no analysis yet (or a failed one due a retry: after half an hour). */
 missing(){return this.db.footage().assets.filter(a=>SoundIndexer.indexable(a)&&!this.saved(a.id)&&!this.recentFailure(a.id)).map(a=>a.id);}
 close(){this.controller.abort();}
 saved(assetId:string){const asset=this.db.footage().assets.find(a=>a.id===assetId),index=this.db.loadState<SoundIndex|Failure>('sound-index:'+assetId);return asset&&index&&index.version===SOUND_ANALYSIS_VERSION&&index.fingerprint===asset.fingerprint&&!('error'in index)?index:undefined;}
 private failure(assetId:string){const index=this.db.loadState<SoundIndex|Failure>('sound-index:'+assetId);return index&&'error'in index?index:undefined;}
 private recentFailure(assetId:string){const f=this.failure(assetId);return!!f&&Date.now()-Date.parse(f.at)<30*60_000;}
 status(assetId:string){
  const index=this.saved(assetId);if(index)return`analysed${index.speakers.count>1?` (${index.speakers.count} voices)`:''}${index.music.length?`, music at ${index.music.map(m=>Math.round(m.bpm)).join('/')} BPM`:''}`;
  if(this.running.has(assetId))return'being analysed';const failed=this.failure(assetId);return failed?`analysis failed (${failed.error.slice(0,80)})`:'waiting';
 }
 /** The analysis of a source, measuring it when missing. Concurrent calls share the work. */
 ensure(assetId:string,signal:AbortSignal):Promise<SoundIndex|undefined>{
  const existing=this.running.get(assetId);if(existing)return existing;
  const work=(async()=>{
   const asset=this.db.footage().assets.find(a=>a.id===assetId);if(!asset||!SoundIndexer.indexable(asset))return undefined;
   const saved=this.saved(assetId);if(saved)return saved;
   const path=asset.audioPath&&existsSync(asset.audioPath)?asset.audioPath:asset.originalPath;
   try{
    const analysis=await this.analyse(samples(this.ffmpeg,path,signal),asset.durationSec,signal),index:SoundIndex={...analysis,assetId,fingerprint:asset.fingerprint,analysedAt:new Date().toISOString()};
    this.db.saveState('sound-index:'+assetId,index);return index;
   }catch(error){
    signal.throwIfAborted();
    this.db.saveState('sound-index:'+assetId,{version:SOUND_ANALYSIS_VERSION,assetId,fingerprint:asset.fingerprint,error:(error as Error).message||String(error),at:new Date().toISOString()} satisfies Failure);return undefined;
   }
  })().finally(()=>this.running.delete(assetId));
  this.running.set(assetId,work);return work;
 }
}

const r1=(n:number)=>(Math.round(n*10)/10).toFixed(1);
const clock=(sec:number)=>{const s=Math.max(0,Math.round(sec)),h=Math.floor(s/3600),m=Math.floor(s%3600/60),r=s%60;return h?`${h}:${String(m).padStart(2,'0')}:${String(r).padStart(2,'0')}`:`${m}:${String(r).padStart(2,'0')}`;};
/** sound.txt: what kind of sound is where, the sounds worth knowing about, the loudest moments, the voices and the music. */
export function soundText(asset:Pick<Asset,'id'|'filename'|'durationSec'|'hasAudio'>,index:SoundIndex|undefined,status:string){
 const head=`# Sound in ${asset.filename} (${asset.id}, ${clock(asset.durationSec)}). Measured on this computer by a sound classifier: what kind of sound is where, notable sounds, the loudest moments, how many voices, and music's tempo. Times are source seconds. The classifier can be wrong; listen to be sure.`;
 if(!asset.hasAudio)return`${head}\n(This source has no sound.)\n`;
 if(!index)return`${head}\n(${status==='waiting'?'Not analysed yet':status[0].toUpperCase()+status.slice(1)}: the analysis arrives here when it finishes.)\n`;
 const voices=index.speakers.count;
 const lines=[head,`Level: ${index.levelDb??'?'} dBFS on average where it is not silent. ${voices===0?'No voices.':voices===1?'One voice.':`${voices} voices: ${Object.entries(index.speakers.share).map(([s,share])=>`${s} ${Math.round(share*100)}%`).join(', ')} of the speech; transcript.txt marks who says each line.`}`,'','## Sections',...index.sections.map(s=>`[${r1(s.start)}-${r1(s.end)}] ${s.kind}${s.label?` (${s.label})`:''}`)];
 lines.push('','## Sounds');
 if(index.events.length)lines.push(...index.events.map(e=>`[${r1(e.start)}-${r1(e.end)}] ${groupWords[e.group]}: ${e.label} (${Math.round(e.score*100)}%)`));else lines.push('(No laughter, applause, cheering, shouting, bangs, alarms, animals, vehicles or weather stood out.)');
 const omitted=Object.entries(index.omitted);if(omitted.length)lines.push(`(Only the strongest 40 of each kind are listed; also ${omitted.map(([g,n])=>`${n} more ${groupWords[g as keyof typeof groupWords]}`).join(', ')}.)`);
 lines.push('','## Loudest moments (above the 30 seconds around them)');
 lines.push(...(index.loud.length?index.loud.map(l=>`[${r1(l.at)}] ${l.rise} dB above its surroundings (${l.db} dBFS)`):['(None stood out.)']));
 if(index.music.length)lines.push('','## Music (every beat is in beats.json)',...index.music.map(m=>`[${r1(m.start)}-${r1(m.end)}] ${m.bpm} BPM, ${m.beats.length} beats from ${r1(m.beats[0]??m.start)} s`));
 return lines.join('\n')+'\n';
}
/** beats.json: every beat of each stretch of music, for code that cuts to the music. */
export const beatsJson=(asset:Pick<Asset,'id'>,index:SoundIndex)=>`{"assetId":${JSON.stringify(asset.id)},"format":"beat times in source seconds, per stretch of music","music":[\n${index.music.map(m=>JSON.stringify(m)).join(',\n')}\n]}\n`;
/** The speaker of a transcript line: the voice that covers most of it, when the source has more than one. */
export function lineSpeaker(turns:SpeakerTurn[],start:number,end:number){
 const time=new Map<string,number>();
 for(const t of turns){const overlap=Math.min(end,t.end)-Math.max(start,t.start);if(overlap>0)time.set(t.speaker,(time.get(t.speaker)??0)+overlap);}
 const top=[...time].sort((a,b)=>b[1]-a[1])[0];return top?.[0]??speakerAt(turns,(start+end)/2);
}
