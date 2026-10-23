import {Input,BlobSource,ALL_FORMATS,AudioSampleSink,AudioSample,AudioSampleSource,Output,Mp4OutputFormat,Mp3OutputFormat,WavOutputFormat,StreamTarget,canEncodeAudio,type OutputFormat,type AudioCodec} from 'mediabunny';
import {registerAacEncoder} from '@mediabunny/aac-encoder';
import {registerMp3Encoder} from '@mediabunny/mp3-encoder';
import {resolve as resolveTimeline,type TimelineDocument} from '@dream/timeline';
import type {FootageIndex} from '@dream/footage';
// The audio half of the compositor only: the rest draws with WebGL, which this worker has no use for.
import {audioManifest,envelope,type AudioSegment} from '../../../../packages/compositor/src/audio';
import {EXPORT_LOUDNESS} from '../../../desktop/src/main/export-loudness';
import {fileAt,writable,exists,remove} from '../project/media/paths';
import {LoudnessMeter} from '../project/media/loudness';
import {stretch} from './stretch';

/** An export's sound in the browser, as the desktop mixes it with ffmpeg (main/export-audio.ts, export-loudness.ts): each
 * segment trimmed, sped with its pitch kept, shaped by the same per-frame envelope the player applies (gain, fades,
 * ducking under speech) and placed at its start; then brought to -14 LUFS with peaks kept below -2 dBTP, and encoded.
 * The mix is made five seconds at a time into a float file beside the export, measured as it is made, then read back
 * through the gain (and a look-ahead limiter when the gain alone would push peaks over) into the encoder, so an hour of
 * sound never sits in memory. */
export type SoundRequest={timeline:TimelineDocument;footage:FootageIndex;output:string;format:'aac'|'mp3'|'wav';workDir:string};
const RATE=48000,BLOCK=RATE*5,CHANNELS=2;

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

/** The mix, written to `file` as interleaved 32-bit floats. Undefined when the timeline has no sound. */
async function mixTo(request:SoundRequest,file:string,signal:AbortSignal){
 const {timeline,footage}=request,resolved=resolveTimeline(timeline,footage),fps=timeline.settings.fps,total=Math.round(resolved.durationInFrames/fps*RATE);
 const segments=audioManifest(timeline,footage).sort((a,b)=>a.startSample-b.startSample);if(!segments.length||total<=0)return;
 // Whether a word is being spoken at a sample: the last word starting by then, or one just before it, still running.
 const words=[...resolved.words].sort((a,b)=>a.start-b.start),speaking=(sample:number)=>{const t=sample/RATE;let lo=0,hi=words.length;while(lo<hi){const mid=(lo+hi)>>1;if(words[mid].start<=t)lo=mid+1;else hi=mid;}for(let k=lo-1;k>=Math.max(0,lo-4);k--)if(words[k].end>t)return true;return false;};
 // The envelope's value for each of a segment's frames, as the desktop sends ffmpeg its volume changes.
 const gainAt=(s:AudioSegment,frame:number)=>{const sample=s.startSample+Math.round(frame/fps*RATE);return Math.round(envelope(s,Math.min(sample,s.startSample+s.durationSamples-1),speaking(sample))*10000)/10000;};
 const sources=new Map<string,Source>(),source=(s:AudioSegment)=>{const asset=footage.assets.find(a=>a.id===s.assetId)!;let found=sources.get(asset.id);if(!found){found=new Source(asset.audioPath??asset.originalPath);sources.set(asset.id,found);}return found;};
 for(const asset of new Set(segments.map(s=>footage.assets.find(a=>a.id===s.assetId)!)))if(asset.audioPath&&!await exists(asset.audioPath))asset.audioPath=undefined;
 const stretched=new Map<AudioSegment,Float32Array[]>(),meter=new LoudnessMeter(CHANNELS),out=await writable(file);
 try{
  for(let from=0;from<total;from+=BLOCK){
   signal.throwIfAborted();const to=Math.min(total,from+BLOCK),mix=Array.from({length:CHANNELS},()=>new Float32Array(to-from));
   for(const s of segments){
    if(s.startSample>=to)break;const end=s.startSample+s.durationSamples;if(end<=from)continue;
    const a=Math.max(from,s.startSample),b=Math.min(to,end);let piece:Float32Array[];
    if(s.speed===1)piece=await source(s).read((s.sourceStartSample+a-s.startSample)/RATE,b-a);
    else{let whole=stretched.get(s);if(!whole){const read=await source(s).read(s.sourceStartSample/RATE,Math.round(s.durationSamples*s.speed)+RATE/10);whole=stretch(read,s.speed,s.durationSamples);stretched.set(s,whole);}piece=whole.map(p=>p.subarray(a-s.startSample,b-s.startSample));}
    let frame=-1,gain=0;
    for(let k=0;k<b-a;k++){const f=Math.floor((a+k-s.startSample)*fps/RATE);if(f!==frame){frame=f;gain=gainAt(s,f);}if(gain)for(let c=0;c<CHANNELS;c++)mix[c][a-from+k]+=piece[c][k]*gain;}
   }
   for(const [s] of stretched)if(s.startSample+s.durationSamples<=to)stretched.delete(s);
   meter.add(mix);const interleaved=new Float32Array((to-from)*CHANNELS);for(let k=0;k<to-from;k++)for(let c=0;c<CHANNELS;c++)interleaved[k*CHANNELS+c]=mix[c][k];
   await out.write(interleaved);
  }
  await out.close();
 }catch(error){await out.abort().catch(()=>{});throw error;}
 finally{for(const s of sources.values())s.close();}
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

const encoders:Record<SoundRequest['format'],{codec:AudioCodec;bitrate:number;format:()=>OutputFormat;register:()=>void}>={
 // 192 kb/s: the most the operating systems' AAC encoders take (Windows Media Foundation's included), and transparent.
 aac:{codec:'aac',bitrate:192_000,format:()=>new Mp4OutputFormat({fastStart:false}),register:registerAacEncoder},
 mp3:{codec:'mp3',bitrate:320_000,format:()=>new Mp3OutputFormat(),register:registerMp3Encoder},
 wav:{codec:'pcm-s16',bitrate:1_536_000,format:()=>new WavOutputFormat(),register:()=>{}},
};

/** Mixes, levels and encodes the export's sound to request.output. False when the timeline has no sound. */
export async function exportSound(request:SoundRequest,signal:AbortSignal):Promise<boolean>{
 const file=`${request.workDir}/mix-${crypto.randomUUID().slice(0,8)}.f32`;
 try{
  const mixed=await mixTo(request,file,signal);if(!mixed)return false;
  const {gain,ceiling,limit}=levelling(mixed.meter),encoder=encoders[request.format];
  // The browser's own encoder when it has one (WebCodecs), else mediabunny's WebAssembly one.
  if(!await canEncodeAudio(encoder.codec,{numberOfChannels:CHANNELS,sampleRate:RATE,bitrate:encoder.bitrate}))encoder.register();
  const target=await writable(request.output),output=new Output({format:encoder.format(),target:new StreamTarget(target as unknown as WritableStream<any>,{chunked:true})});
  const audio=new AudioSampleSource({codec:encoder.codec,bitrate:encoder.bitrate});output.addAudioTrack(audio);await output.start();
  try{
   const mix=await fileAt(file),look=Math.round(RATE*.005),recover=1-Math.exp(-1/(RATE*.08));let held=1;
   for(let from=0;from<mixed.total;from+=BLOCK){
    signal.throwIfAborted();const count=Math.min(BLOCK,mixed.total-from),ahead=limit?Math.min(look,mixed.total-from-count):0;
    const samples=new Float32Array(await mix.slice(from*CHANNELS*4,(from+count+ahead)*CHANNELS*4).arrayBuffer());
    if(limit){
     // A look-ahead limiter: the gain each sample needs to stay under the ceiling, its minimum over the next 5 ms (a
     // queue of falling needs), dropping at once and recovering over 80 ms.
     const need=new Float32Array(count+ahead);for(let k=0;k<count+ahead;k++){let top=0;for(let c=0;c<CHANNELS;c++)top=Math.max(top,Math.abs(samples[k*CHANNELS+c]));need[k]=top*gain>ceiling?ceiling/(top*gain):1;}
     const queue=new Int32Array(count+ahead);let head=0,tail=0;
     for(let j=0;j<count+ahead;j++){while(tail>head&&need[queue[tail-1]]>=need[j])tail--;queue[tail++]=j;const k=j-look;if(k<0)continue;if(queue[head]<k)head++;held=Math.min(need[queue[head]],held+(1-held)*recover);for(let c=0;c<CHANNELS;c++)samples[k*CHANNELS+c]*=gain*held;}
     // The block's last samples, whose look-ahead runs past the end of the sound.
     for(let k=Math.max(0,count+ahead-look);k<count;k++){if(queue[head]<k)head++;held=Math.min(need[queue[head]]??1,held+(1-held)*recover);for(let c=0;c<CHANNELS;c++)samples[k*CHANNELS+c]*=gain*held;}
    }else if(gain!==1)for(let i=0;i<count*CHANNELS;i++)samples[i]*=gain;
    const sample=new AudioSample({data:samples.subarray(0,count*CHANNELS),format:'f32',numberOfChannels:CHANNELS,sampleRate:RATE,timestamp:from/RATE});
    try{await audio.add(sample);}finally{sample.close();}
   }
   audio.close();await output.finalize();
  }catch(error){await output.cancel().catch(()=>{});await remove(request.output).catch(()=>{});throw error;}
  return true;
 }finally{await remove(file).catch(()=>{});}
}
