import {spawn} from 'node:child_process';
import {existsSync,mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {audioManifest,envelope} from '../../../packages/compositor/src/audio';
import {resolve as resolveTimeline,type TimelineDocument} from '@dream/timeline';
import type {FootageIndex} from '@dream/footage';

/** Listening: the agent hears a stretch of sound (a source, a file it made, or the edit's own mix) through a model that can
 * hear, and gets the loudness measured beside it. The edit's mix is made the way Export mixes it (each sound's gain, fades
 * and ducking under speech), only for the stretch asked for, as a small MP3: hearing it is like looking at a frame the
 * player draws, not a render of the edit. */
export const MAX_LISTEN_SEC=90;
export const listenSystem='You listen to audio for a video editor and say what is audible, as facts. Cover: speech (who is speaking, the language, clear or muffled, words cut off), music (genre, mood, tempo, instruments, where it starts, stops or changes, how loud it sits against speech), sound effects (what they are, when, whether they fit or jar), and problems (clipping, distortion, hum, wind, sudden jumps in level, silence, abrupt cuts). Give times in seconds from the start of the clip. If a question is asked, answer it first. Be brief and concrete; never guess at what you cannot hear.';
const num=(n:number)=>(Math.round(n*1e6)/1e6).toString();

function ffmpegRun(ffmpeg:string,args:string[],signal:AbortSignal,cwd?:string){return new Promise<string>((resolve,reject)=>{
 const child=spawn(ffmpeg,args,{windowsHide:true,signal,cwd});let log='';child.stderr.on('data',chunk=>{log=(log+chunk.toString()).slice(-20000);});child.stdout?.resume();
 child.on('error',reject);child.on('close',code=>code===0?resolve(log):reject(new Error('The sound could not be prepared. '+log.slice(-600))));
});}
const encode=['-ac','1','-ar','24000','-c:a','libmp3lame','-b:a','64k'];

/** A stretch of a media file's sound as a small MP3. */
export async function extractAudio(ffmpeg:string,path:string,startSec:number,endSec:number,signal:AbortSignal){
 const folder=mkdtempSync(join(tmpdir(),'dream-listen-')),out=join(folder,'clip.mp3');
 try{await ffmpegRun(ffmpeg,['-hide_banner','-v','error','-y','-ss',num(startSec),'-t',num(endSec-startSec),'-i',path,'-vn',...encode,out],signal);return readFileSync(out);}
 finally{rmSync(folder,{recursive:true,force:true});}
}

/** The edit's sound between two timeline times, mixed as Export mixes it. Undefined when nothing sounds there. */
export async function mixEditRange(ffmpeg:string,timeline:TimelineDocument,footage:FootageIndex,startSec:number,endSec:number,signal:AbortSignal){
 const rate=48000,fps=timeline.settings.fps,from=Math.round(startSec*rate),to=Math.round(endSec*rate),resolved=resolveTimeline(timeline,footage);
 const segments=audioManifest(timeline,footage).filter(s=>s.startSample<to&&s.startSample+s.durationSamples>from).sort((a,b)=>b.gainDb-a.gainDb).slice(0,48);
 if(!segments.length)return undefined;
 const words=[...resolved.words].sort((a,b)=>a.start-b.start),speaking=(sample:number)=>{const t=sample/rate;let lo=0,hi=words.length;while(lo<hi){const mid=(lo+hi)>>1;if(words[mid].start<=t)lo=mid+1;else hi=mid;}for(let k=lo-1;k>=Math.max(0,lo-4);k--)if(words[k].end>t)return true;return false;};
 const folder=mkdtempSync(join(tmpdir(),'dream-listen-')),args=['-hide_banner','-v','error','-y'],filters:string[]=[],labels:string[]=[];
 try{
  segments.forEach((segment,n)=>{
   const asset=footage.assets.find(a=>a.id===segment.assetId);if(!asset)return;const path=asset.audioPath&&existsSync(asset.audioPath)?asset.audioPath:asset.originalPath;if(!existsSync(path))return;
   // Only the part of this sound inside the stretch: where it starts in the stretch, and how far into the source that is.
   const first=Math.max(from,segment.startSample),last=Math.min(to,segment.startSample+segment.durationSamples),length=(last-first)/rate,skip=(first-segment.startSample)/rate;
   args.push('-ss',num(segment.sourceStartSample/rate+skip*segment.speed),'-t',num(length*segment.speed+.1),'-i',path);
   const commands:string[]=[];let previous=-1;
   for(let f=0;f<=Math.ceil(length*fps);f++){const sample=first+Math.round(f/fps*rate),value=Math.round(envelope(segment,Math.min(sample,segment.startSample+segment.durationSamples-1),speaking(sample))*10000)/10000;if(value!==previous){commands.push(`${num(f/fps)} volume@v${n} volume ${value};`);previous=value;}}
   writeFileSync(join(folder,`envelope-${n}.cmd`),commands.join('\n'));
   let remaining=segment.speed;const factors:number[]=[];while(remaining>2){factors.push(2);remaining/=2;}while(remaining<.5){factors.push(.5);remaining/=.5;}factors.push(remaining);const tempo=segment.speed!==1?factors.map(x=>`atempo=${num(x)}`).join(',')+',':'';
   const input=labels.length;filters.push(`[${input}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,${tempo}atrim=0:${num(length)},asetpts=PTS-STARTPTS,asendcmd=f=envelope-${n}.cmd,volume@v${n}=0:eval=frame,adelay=${first-from}S:all=1[a${input}]`);labels.push(`[a${input}]`);
  });
  if(!labels.length)return undefined;
  filters.push(`${labels.join('')}amix=inputs=${labels.length}:normalize=0:dropout_transition=0,apad,atrim=end_sample=${to-from}[mix]`);
  writeFileSync(join(folder,'mix.graph'),filters.join(';\n'));
  await ffmpegRun(ffmpeg,[...args,'-filter_complex_script','mix.graph','-map','[mix]',...encode,'clip.mp3'],signal,folder);
  return readFileSync(join(folder,'clip.mp3'));
 }finally{rmSync(folder,{recursive:true,force:true});}
}

/** Loudness of a clip: integrated loudness, loudness range, true peak, and the silent spans (below -45 dB for 0.3 s or more). */
export async function measureClip(ffmpeg:string,mp3:Buffer,signal:AbortSignal){
 const folder=mkdtempSync(join(tmpdir(),'dream-listen-')),file=join(folder,'clip.mp3');writeFileSync(file,mp3);
 try{
  const log=await ffmpegRun(ffmpeg,['-hide_banner','-i',file,'-af','silencedetect=noise=-45dB:d=0.3,ebur128=peak=true','-f','null','-'],signal);
  const summary=log.slice(log.lastIndexOf('Summary:')),pick=(re:RegExp)=>{const m=summary.match(re);return m?Number(m[1]):undefined;};
  const silences:string[]=[];const starts=[...log.matchAll(/silence_start: ([\d.]+)/g)].map(m=>Number(m[1])),ends=[...log.matchAll(/silence_end: ([\d.]+)/g)].map(m=>Number(m[1]));
  starts.forEach((s,i)=>silences.push(`${Math.round(s*10)/10}-${ends[i]!==undefined?Math.round(ends[i]*10)/10:'end'}s`));
  return{integratedLufs:pick(/I:\s+(-?[\d.]+) LUFS/),loudnessRangeLu:pick(/LRA:\s+(-?[\d.]+) LU/),truePeakDb:pick(/Peak:\s+(-?[\d.]+) dBFS/),...(silences.length?{silent:silences.slice(0,20)}:{})};
 }finally{rmSync(folder,{recursive:true,force:true});}
}
