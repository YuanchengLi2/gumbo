import {Output,Mp4OutputFormat,MovOutputFormat,StreamTarget,CanvasSource,Input,UrlSource,ALL_FORMATS,VideoSampleSink,type VideoSample} from 'mediabunny';
import {prepare,frameAt,Compositor,type MediaLayer} from '@dream/compositor';
import type {TimelineDocument} from '@dream/timeline';
import type {FootageIndex,Asset} from '@dream/footage';
import {previewUrl} from './player';

/** Export, as CapCut does it: each output frame is drawn by the same compositor the player uses, from source frames decoded
 * exactly (WebCodecs, on the graphics card), and encoded by the graphics card's H.264 or HEVC encoder straight from the
 * canvas. Nothing is drawn twice and nothing goes through a screenshot. The video is written in pieces as it is encoded;
 * the sound is mixed separately and joined to it afterwards. */
export type VideoJob={timeline:TimelineDocument;footage:FootageIndex;width:number;height:number;fps:number;codec:'h264'|'hevc';quality:'lower'|'recommended'|'higher';container:'mp4'|'mov';
 write:(data:Uint8Array,position:number)=>Promise<void>;onProgress:(done:number,total:number)=>void;signal:AbortSignal};

// Bits per pixel each frame for each bit rate choice (HEVC needs about 40% less), the same figures the window estimates with.
const BPP={lower:.05,recommended:.1,higher:.16};
export const videoBitrate=(job:Pick<VideoJob,'width'|'height'|'fps'|'codec'|'quality'>)=>Math.round(BPP[job.quality]*(job.codec==='hevc'?.6:1)*job.width*job.height*job.fps);
export const originalUrl=(a:Asset)=>'dream-media://'+a.id+'/original';

/** Delivers a clip's source frames in order: the frame showing at each requested source time, decoding forward and only
 * starting over when time goes back. A source that ends early keeps its last frame. */
class Reader{
 private iterator?:AsyncGenerator<VideoSample,void,unknown>;private current?:VideoSample;private upcoming?:VideoSample;private ended=false;
 constructor(private sink:VideoSampleSink){}
 private restart(time:number){void this.iterator?.return();this.current?.close();this.upcoming?.close();this.current=this.upcoming=undefined;this.ended=false;this.iterator=this.sink.samples(Math.max(0,time));}
 async at(time:number){
  if(!this.iterator||(this.current&&time<this.current.timestamp-1e-3)||(this.current&&time>this.current.timestamp+3))this.restart(time);
  for(;;){
   if(!this.upcoming&&!this.ended){const next=await this.iterator!.next();if(next.done)this.ended=true;else this.upcoming=next.value;}
   if(this.upcoming&&this.upcoming.timestamp<=time+1e-4){this.current?.close();this.current=this.upcoming;this.upcoming=undefined;continue;}
   return this.current??this.upcoming;
  }
 }
 close(){void this.iterator?.return();this.current?.close();this.upcoming?.close();}
}

export async function renderVideo(job:VideoJob){
 const p=prepare({timeline:job.timeline,footage:job.footage}),total=Math.max(1,Math.round(p.resolved.durationSec*job.fps));
 const canvas=new OffscreenCanvas(job.width,job.height),compositor=new Compositor(canvas);
 const output=new Output({format:job.container==='mov'?new MovOutputFormat():new Mp4OutputFormat(),target:new StreamTarget(new WritableStream({write:chunk=>job.write(chunk.data,chunk.position)}),{chunked:true})});
 const source=new CanvasSource(canvas,{codec:job.codec==='hevc'?'hevc':'avc',bitrate:videoBitrate(job),keyFrameInterval:2,hardwareAcceleration:'prefer-hardware',latencyMode:'quality'});
 output.addVideoTrack(source,{frameRate:job.fps});await output.start();
 const inputs=new Map<string,{input:Input;sink:Promise<VideoSampleSink|undefined>}>(),readers=new Map<string,{reader:Reader;last:number}>(),images=new Map<string,ImageBitmap>();
 const sink=(asset:Asset)=>{let entry=inputs.get(asset.id);if(!entry){const input=new Input({source:new UrlSource(originalUrl(asset)),formats:ALL_FORMATS});entry={input,sink:input.getPrimaryVideoTrack().then(async track=>track&&await track.canDecode()?new VideoSampleSink(track):undefined)};inputs.set(asset.id,entry);}return entry.sink;};
 // A source this computer cannot decode (a format WebCodecs does not read) uses the playback copy made at import.
 const fallback=new Map<string,Input>(),playbackSink=async(asset:Asset)=>{let input=fallback.get(asset.id);if(!input){input=new Input({source:new UrlSource(previewUrl(asset)),formats:ALL_FORMATS});fallback.set(asset.id,input);}const track=await input.getPrimaryVideoTrack();return track?new VideoSampleSink(track):undefined;};
 const image=async(url:string)=>{let bitmap=images.get(url);if(!bitmap){bitmap=await createImageBitmap(await (await fetch(url)).blob());images.set(url,bitmap);if(images.size>240){const [first,old]=images.entries().next().value!;old.close();images.delete(first);}}return bitmap;};
 try{
  for(let n=0;n<total;n++){
   job.signal.throwIfAborted();const time=n/job.fps,frame=frameAt(p,time),pictures=new Map<MediaLayer,TexImageSource>();
   for(const layer of frame.layers){if(layer.kind!=='media')continue;const asset=p.assets.get(layer.assetId);if(!asset)continue;
    if(layer.media==='video'){let entry=readers.get(layer.key);
     if(!entry){const s=await sink(asset)??await playbackSink(asset);if(!s)throw new Error(`${asset.filename} has no video this computer can decode.`);entry={reader:new Reader(s),last:n};readers.set(layer.key,entry);}
     entry.last=n;const sample=await entry.reader.at(layer.time);if(sample)pictures.set(layer,sample.toCanvasImageSource());}
    else pictures.set(layer,await image(layer.media==='sequence'?previewUrl(asset)+'&frame='+(layer.frameIndex??0):previewUrl(asset)));}
   compositor.draw(frame,layer=>pictures.get(layer));
   await source.add(time,1/job.fps);
   // A clip that has not been drawn for a second is finished with: its decoder is released.
   for(const [key,entry] of readers)if(n-entry.last>job.fps){entry.reader.close();readers.delete(key);}
   if(n%5===0||n===total-1)job.onProgress(n+1,total);
  }
  source.close();await output.finalize();
 }catch(error){await output.cancel().catch(()=>{});throw error;}
 finally{for(const {reader} of readers.values())reader.close();for(const b of images.values())b.close();for(const {input} of inputs.values())input.dispose?.();for(const input of fallback.values())input.dispose?.();compositor.dispose();}
}
