import {spawn} from 'node:child_process';
import {writeFileSync,mkdirSync,rmSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {resolve as resolveTimeline,type TimelineDocument,type ResolvedTimeline} from '@dream/timeline';
import type {FootageIndex} from '@dream/footage';
import {audioManifest,envelope} from '@dream/compositor';
import {encodeAtLoudness} from './export-loudness';

/** The export's sound, mixed by ffmpeg from the same per-frame envelope the player applies. The engine export draws the
 * picture in the window and joins this mix to it (engine-export.ts); the audio-only export writes it on its own. */
export type AudioOptions={ffmpeg:string;timeline:TimelineDocument;footage:FootageIndex;workDir:string;signal?:AbortSignal};

const num=(n:number)=>Number(n.toFixed(6)).toString();
function runFfmpeg(ffmpeg:string,args:string[],signal?:AbortSignal,cwd?:string){return new Promise<void>((resolve,reject)=>{const child=spawn(ffmpeg,args,{windowsHide:true,signal,cwd});let log='';child.stderr.on('data',chunk=>{log=(log+chunk.toString()).slice(-4000);});child.on('error',reject);child.on('close',code=>code===0?resolve():reject(new Error('ffmpeg failed: '+log.slice(-1500))));});}

/** The sound: each segment trimmed, sped (pitch kept), shaped by the same per-frame envelope the player applies (gain, fades,
 * ducking under speech), and placed at its start. Segments are mixed in batches, in timeline order, each batch covering only
 * its own stretch (a long edit has hundreds of segments, more inputs than one command line can hold), and the batches are
 * then mixed into the whole. The filter graphs are read from files for the same reason. */
async function mixAudio(o:AudioOptions,resolved:ResolvedTimeline,output:string){
 const fps=o.timeline.settings.fps,totalSamples=Math.round(resolved.durationInFrames/fps*48000);
 const segments=audioManifest(o.timeline,o.footage).map((segment,i)=>({segment,i})).sort((a,b)=>a.segment.startSample-b.segment.startSample);if(!segments.length)return false;
 // Whether a word is being spoken at a sample: the last word starting by then, or one just before it, still running.
 const words=[...resolved.words].sort((a,b)=>a.start-b.start),speaking=(sample:number)=>{const t=sample/48000;let lo=0,hi=words.length;while(lo<hi){const mid=(lo+hi)>>1;if(words[mid].start<=t)lo=mid+1;else hi=mid;}for(let k=lo-1;k>=Math.max(0,lo-4);k--)if(words[k].end>t)return true;return false;};
 const mix=async(batch:typeof segments,from:number,to:number,file:string)=>{
  const args=['-hide_banner','-v','error','-y'],filters:string[]=[],labels:string[]=[];
  batch.forEach(({segment,i},n)=>{
   const asset=o.footage.assets.find(a=>a.id===segment.assetId)!,path=asset.audioPath&&existsSync(asset.audioPath)?asset.audioPath:asset.originalPath,length=segment.durationSamples/48000;
   args.push('-ss',num(segment.sourceStartSample/48000),'-t',num(length*segment.speed+.1),'-i',path);
   // The envelope per frame, as a command file: one volume change wherever the value changes.
   const commands:string[]=[];let previous=-1;
   for(let f=0;f<=Math.ceil(length*fps);f++){const sample=segment.startSample+Math.round(f/fps*48000),value=Math.round(envelope(segment,Math.min(sample,segment.startSample+segment.durationSamples-1),speaking(sample))*10000)/10000;if(value!==previous){commands.push(`${num(f/fps)} volume@v${i} volume ${value};`);previous=value;}}
   writeFileSync(join(o.workDir,`envelope-${i}.cmd`),commands.join('\n'));
   let tempo='';let remaining=segment.speed;const factors:number[]=[];while(remaining>2){factors.push(2);remaining/=2;}while(remaining<.5){factors.push(.5);remaining/=.5;}factors.push(remaining);if(segment.speed!==1)tempo=factors.map(n=>`atempo=${num(n)}`).join(',')+',';
   filters.push(`[${n}:a]aresample=48000,aformat=sample_fmts=fltp:channel_layouts=stereo,${tempo}atrim=0:${num(length)},asetpts=PTS-STARTPTS,asendcmd=f=envelope-${i}.cmd,volume@v${i}=0:eval=frame,adelay=${segment.startSample-from}S:all=1[a${n}]`);labels.push(`[a${n}]`);
  });
  filters.push(`${labels.join('')}amix=inputs=${labels.length}:normalize=0:dropout_transition=0,apad,atrim=end_sample=${to-from}[mix]`);
  const graph=`${file}.graph`;writeFileSync(graph,filters.join(';\n'));
  args.push('-filter_complex_script',graph,'-map','[mix]','-c:a','pcm_f32le',file);
  await runFfmpeg(o.ffmpeg,args,o.signal,o.workDir);
 };
 const size=32,batches=Array.from({length:Math.ceil(segments.length/size)},(_,k)=>segments.slice(k*size,(k+1)*size));
 if(batches.length===1){await mix(segments,0,totalSamples,output);return true;}
 const parts=await Promise.all(batches.map(async(batch,k)=>{const from=batch[0].segment.startSample,to=Math.min(totalSamples,Math.max(...batch.map(s=>s.segment.startSample+s.segment.durationSamples))),file=join(o.workDir,`mix-${k}.wav`);await mix(batch,from,to,file);return{file,from};}));
 const filters=[...parts.map((p,k)=>`[${k}:a]adelay=${p.from}S:all=1[b${k}]`),`${parts.map((_,k)=>`[b${k}]`).join('')}amix=inputs=${parts.length}:normalize=0:dropout_transition=0,apad,atrim=end_sample=${totalSamples}[mix]`],graph=join(o.workDir,'mix.graph');
 writeFileSync(graph,filters.join(';\n'));
 await runFfmpeg(o.ffmpeg,['-hide_banner','-v','error','-y',...parts.flatMap(p=>['-i',p.file]),'-filter_complex_script',graph,'-map','[mix]','-c:a','pcm_f32le',output],o.signal,o.workDir);
 for(const p of parts)rmSync(p.file,{force:true});
 return true;
}

/** The sound alone, as CapCut's audio export: the same mix as the video's, levelled to the same loudness, written as MP3,
 * WAV or AAC without drawing a frame. False when the timeline has no sound. */
export async function exportAudio(o:AudioOptions,output:string,format:'mp3'|'wav'|'aac'){
 mkdirSync(o.workDir,{recursive:true});const mix=join(o.workDir,'mix.wav');
 try{if(!await mixAudio(o,resolveTimeline(o.timeline,o.footage),mix))return false;
  await encodeAtLoudness(o.ffmpeg,mix,output,o.signal,format==='mp3'?['-c:a','libmp3lame','-b:a','320k']:format==='wav'?['-c:a','pcm_s16le']:undefined);return true;}
 finally{rmSync(o.workDir,{recursive:true,force:true});}
}
