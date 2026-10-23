import {Input,BlobSource,ALL_FORMATS,AudioSampleSink} from 'mediabunny';
import {resolve as resolveTimeline,type TimelineDocument} from '@dream/timeline';
import type {FootageIndex} from '@dream/footage';
// The audio half of the compositor only: the rest draws with WebGL, which the workers using this have no use for.
import {audioManifest,envelope,type AudioSegment} from '../../../../packages/compositor/src/audio';
import {EXPORT_LOUDNESS} from '../../../desktop/src/main/export-loudness';
import {fileAt,writable,exists,remove} from '../project/media/paths';
import {LoudnessMeter} from '../project/media/loudness';
import {encodeAudio,type AudioFormat} from '../project/media/audio-encode';
import {stretch} from './stretch';

/** An edit's sound in the browser, as the desktop mixes it with ffmpeg (main/export-audio.ts, export-loudness.ts,
 * project-service edit-audio.ts): each segment trimmed, sped with its pitch kept, shaped by the same per-frame envelope
 * the player applies (gain, fades, ducking under speech) and placed at its start. The export brings the whole to -14 LUFS
 * with peaks kept below -2 dBTP and encodes it: the mix is made five seconds at a time into a float file beside the
 * export, measured as it is made, then read back through the gain (and a look-ahead limiter when the gain alone would
 * push peaks over) into the encoder, so an hour of sound never sits in memory. Roux's listening mixes a stretch of it. */
export type SoundRequest={timeline:TimelineDocument;footage:FootageIndex;output:string;format:AudioFormat;workDir:string};
export const RATE=48000;
const BLOCK=RATE*5,CHANNELS=2;

/** A source's sound read by time, at 48 kHz stereo: decoded by mediabunny, resampled linearly when its rate differs. */
class Source{
 private sink:Promise<AudioSampleSink|undefined>;private input?:Input;
 constructor(path:string){this.sink=fileAt(path).then(async file=>{this.input=new Input({source:new BlobSource(file),formats:ALL_FORMATS});const track=await this.input.getPrimaryAudioTrack();return track?new AudioSampleSink(track):undefined;});}
 async read(fromSec:number,count:number):Promise<Float32Array[]>{
  const out=Array.from({length:CHANNELS},()=>new Float32Array(count)),sink=await this.sink;if(!sink||count<=0)return out;
  for await(const sample of sink.samples(Math.max(0,fromSec-.05),fromSec+count/RATE+.05)){
   const n=sample.numberOfFrames,rate=sample.sampleRate,planes:Float32Array[]=[];
   for(let c=0;c<Math.min(CHANNELS,sample.numberOfChannels);c++){const plane=new Float32Array(n);sample.copyTo(plane,{planeIndex:c,format:'f32-planar'});planes.push(plane);}
   const begin=Math.max(0,Math.ceil((sample.timestamp-fromSec)*RATE-1e-6)),end=Math.min(count,Math.ceil((sample.timestamp+n/rate-fromSec)*RATE-1e-6));sample.close();
   for(let k=begin;k<end;k++){const x=(fromSec+k/RATE-sample.timestamp)*rate,i=Math.max(0,Math.floor(x)),f=x-i;
    for(let c=0;c<CHANNELS;c++){const p=planes[Math.min(c,planes.length-1)],a=p[Math.min(i,n-1)],b=p[Math.min(i+1,n-1)];out[c][k]=a+(b-a)*f;}}
  }
  return out;
 }
 close(){this.input?.dispose?.();}
}

/** The segments that sound between samples from and to; none when the edit is silent there. */
export function soundingSegments(timeline:TimelineDocument,footage:FootageIndex,from=0,to=Infinity){return audioManifest(timeline,footage).filter(s=>s.startSample<to&&s.startSample+s.durationSamples>from).sort((a,b)=>a.startSample-b.startSample);}
export const totalSamples=(timeline:TimelineDocument,footage:FootageIndex)=>Math.round(resolveTimeline(timeline,footage).durationInFrames/timeline.settings.fps*RATE);

/** The mix of samples [from,to), five seconds at a time, as planar 48 kHz stereo. */
export async function*mixBlocks(timeline:TimelineDocument,footage:FootageIndex,from:number,to:number,signal:AbortSignal):AsyncGenerator<Float32Array[]>{
 const resolved=resolveTimeline(timeline,footage),fps=timeline.settings.fps,segments=soundingSegments(timeline,footage,from,to);
 // Whether a word is being spoken at a sample: the last word starting by then, or one just before it, still running.
 const words=[...resolved.words].sort((a,b)=>a.start-b.start),speaking=(sample:number)=>{const t=sample/RATE;let lo=0,hi=words.length;while(lo<hi){const mid=(lo+hi)>>1;if(words[mid].start<=t)lo=mid+1;else hi=mid;}for(let k=lo-1;k>=Math.max(0,lo-4);k--)if(words[k].end>t)return true;return false;};
 // The envelope's value for each of a segment's frames, as the desktop sends ffmpeg its volume changes.
 const gainAt=(s:AudioSegment,frame:number)=>{const sample=s.startSample+Math.round(frame/fps*RATE);return Math.round(envelope(s,Math.min(sample,s.startSample+s.durationSamples-1),speaking(sample))*10000)/10000;};
 const assets=new Map(footage.assets.map(a=>[a.id,a])),sources=new Map<string,Source>();
 for(const s of segments){const asset=assets.get(s.assetId);if(asset?.audioPath&&!await exists(asset.audioPath))assets.set(asset.id,{...asset,audioPath:undefined});}
 const source=(s:AudioSegment)=>{const asset=assets.get(s.assetId)!;let found=sources.get(asset.id);if(!found){found=new Source(asset.audioPath??asset.originalPath);sources.set(asset.id,found);}return found;};
 const stretched=new Map<AudioSegment,Float32Array[]>();
 try{
  for(let start=from;start<to;start+=BLOCK){
   signal.throwIfAborted();const end=Math.min(to,start+BLOCK),mix=Array.from({length:CHANNELS},()=>new Float32Array(end-start));
   for(const s of segments){
    if(s.startSample>=end)break;const last=s.startSample+s.durationSamples;if(last<=start)continue;
    const a=Math.max(start,s.startSample),b=Math.min(end,last);let piece:Float32Array[];
    if(s.speed===1)piece=await source(s).read((s.sourceStartSample+a-s.startSample)/RATE,b-a);
    else{let whole=stretched.get(s);if(!whole){const read=await source(s).read(s.sourceStartSample/RATE,Math.round(s.durationSamples*s.speed)+RATE/10);whole=stretch(read,s.speed,s.durationSamples);stretched.set(s,whole);}piece=whole.map(p=>p.subarray(a-s.startSample,b-s.startSample));}
    let frame=-1,gain=0;
    for(let k=0;k<b-a;k++){const f=Math.floor((a+k-s.startSample)*fps/RATE);if(f!==frame){frame=f;gain=gainAt(s,f);}if(gain)for(let c=0;c<CHANNELS;c++)mix[c][a-start+k]+=piece[c][k]*gain;}
   }
   for(const [s] of stretched)if(s.startSample+s.durationSamples<=end)stretched.delete(s);
   yield mix;
  }
 }finally{for(const s of sources.values())s.close();}
}

/** The whole mix, written to `file` as interleaved 32-bit floats and measured as it goes. */
async function mixTo(request:SoundRequest,file:string,signal:AbortSignal){
 const total=totalSamples(request.timeline,request.footage);if(total<=0||!soundingSegments(request.timeline,request.footage).length)return;
 const meter=new LoudnessMeter(CHANNELS),out=await writable(file);
 try{
  for await(const mix of mixBlocks(request.timeline,request.footage,0,total,signal)){
   meter.add(mix);const n=mix[0].length,interleaved=new Float32Array(n*CHANNELS);for(let k=0;k<n;k++)for(let c=0;c<CHANNELS;c++)interleaved[k*CHANNELS+c]=mix[c][k];
   await out.write(interleaved);
  }
  await out.close();
 }catch(error){await out.abort().catch(()=>{});throw error;}
 return{total,meter};
}

/** The gain that brings the mix to the standard level, and the ceiling its peaks are held under (half a decibel below
 * the standard's, for what encoding adds). A silent mix is left as it is. */
function levelling(meter:LoudnessMeter){
 const measured=meter.integrated(),ceiling=Math.pow(10,(EXPORT_LOUDNESS.truePeak-.5)/20);
 if(measured<-60)return{gain:1,ceiling,limit:false};
 const gain=Math.pow(10,(EXPORT_LOUDNESS.integrated-measured)/20);
 return{gain,ceiling,limit:meter.truePeak*gain>ceiling};
}
/** The mix read back from its file, levelled: the gain, through a look-ahead limiter when needed (the gain each sample
 * needs to stay under the ceiling, its minimum over the next 5 ms by a queue of falling needs, dropping at once and
 * recovering over 80 ms). */
async function*levelled(file:string,total:number,level:ReturnType<typeof levelling>,signal:AbortSignal):AsyncGenerator<Float32Array[]>{
 const {gain,ceiling,limit}=level,mix=await fileAt(file),look=Math.round(RATE*.005),recover=1-Math.exp(-1/(RATE*.08));let held=1;
 for(let from=0;from<total;from+=BLOCK){
  signal.throwIfAborted();const count=Math.min(BLOCK,total-from),ahead=limit?Math.min(look,total-from-count):0;
  const samples=new Float32Array(await mix.slice(from*CHANNELS*4,(from+count+ahead)*CHANNELS*4).arrayBuffer());
  if(limit){
   const need=new Float32Array(count+ahead);for(let k=0;k<count+ahead;k++){let top=0;for(let c=0;c<CHANNELS;c++)top=Math.max(top,Math.abs(samples[k*CHANNELS+c]));need[k]=top*gain>ceiling?ceiling/(top*gain):1;}
   const queue=new Int32Array(count+ahead);let head=0,tail=0;
   for(let j=0;j<count+ahead;j++){while(tail>head&&need[queue[tail-1]]>=need[j])tail--;queue[tail++]=j;const k=j-look;if(k<0)continue;if(queue[head]<k)head++;held=Math.min(need[queue[head]],held+(1-held)*recover);for(let c=0;c<CHANNELS;c++)samples[k*CHANNELS+c]*=gain*held;}
   // The block's last samples, whose look-ahead runs past the end of the sound.
   for(let k=Math.max(0,count+ahead-look);k<count;k++){if(queue[head]<k)head++;held=Math.min(need[queue[head]]??1,held+(1-held)*recover);for(let c=0;c<CHANNELS;c++)samples[k*CHANNELS+c]*=gain*held;}
  }else if(gain!==1)for(let i=0;i<count*CHANNELS;i++)samples[i]*=gain;
  const planes=Array.from({length:CHANNELS},()=>new Float32Array(count));for(let k=0;k<count;k++)for(let c=0;c<CHANNELS;c++)planes[c][k]=samples[k*CHANNELS+c];
  yield planes;
 }
}

const bitrates:Record<AudioFormat,number>={aac:192_000,mp3:320_000,wav:1_536_000};
/** Mixes, levels and encodes the export's sound to request.output. False when the timeline has no sound. */
export async function exportSound(request:SoundRequest,signal:AbortSignal):Promise<boolean>{
 const file=`${request.workDir}/mix-${crypto.randomUUID().slice(0,8)}.f32`;
 try{
  const mixed=await mixTo(request,file,signal);if(!mixed)return false;
  await encodeAudio(levelled(file,mixed.total,levelling(mixed.meter),signal),{format:request.format,rate:RATE,channels:CHANNELS,bitrate:bitrates[request.format]},request.output,signal);
  return true;
 }finally{await remove(file).catch(()=>{});}
}
