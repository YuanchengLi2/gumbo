import './decoder-fix';
import {Output,Mp4OutputFormat,MovOutputFormat,StreamTarget,CanvasSource,Input,UrlSource,BlobSource,ALL_FORMATS,VideoSampleSink,type VideoSample,type InputVideoTrack} from 'mediabunny';
import {MEDIA} from '@dream/config';
import {prepare,frameAt,Compositor,type MediaLayer,type Picture} from '@dream/compositor';
import type {TimelineDocument} from '@dream/timeline';
import type {FootageIndex,Asset} from '@dream/footage';
import {previewUrl} from './player';
import {SceneCaptures} from './scenes';

/** Export, as CapCut does it: each output frame is drawn by the same compositor the player uses, from source frames decoded
 * exactly (WebCodecs, on the graphics card), and encoded by the graphics card's H.264 or HEVC encoder straight from the
 * canvas. Nothing is drawn twice and nothing goes through a screenshot. The video is written in pieces as it is encoded;
 * the sound is mixed separately and joined to it afterwards. */
export type VideoJob={timeline:TimelineDocument;footage:FootageIndex;width:number;height:number;fps:number;codec:'h264'|'hevc';quality:'lower'|'recommended'|'higher';container:'mp4'|'mov';
 write:(data:Uint8Array,position:number)=>Promise<void>;onProgress:(done:number,total:number)=>void;signal:AbortSignal};

// Bits per pixel each frame for each bit rate choice (HEVC needs about 40% less), the same figures the window estimates with.
const BPP={lower:.05,recommended:.1,higher:.16};
export const videoBitrate=(job:Pick<VideoJob,'width'|'height'|'fps'|'codec'|'quality'>)=>Math.round(BPP[job.quality]*(job.codec==='hevc'?.6:1)*job.width*job.height*job.fps);
export const originalUrl=(a:Asset)=>MEDIA+a.id+'/original';
/** A video track decoded in the colours the preview plays it in. A file that does not say its colour matrix (an ffmpeg
 * render, a screen recording) is read by the preview's <video> as Chromium guesses: BT.601 below 720 lines, BT.709 from
 * 720 up. WebCodecs gets no guess (mediabunny fills in BT.709 at every size), so an untagged SD file exported with its
 * saturated colours shifted (pure green 255 in the preview, 216 in the export). The decoder is told the same guess. */
export async function decodedAsPlayed(track:InputVideoTrack){
 const space=await track.getColorSpace(),config=await track.getDecoderConfig();if(space.matrix||track.codedHeight>=720||!config)return track;
 track.getDecoderConfig=async()=>({...config,colorSpace:{primaries:space.primaries??'smpte170m',transfer:space.transfer??'smpte170m',matrix:'smpte170m',fullRange:space.fullRange??false}});return track;
}
/** Where an export's drawing time went, in milliseconds, for the export log: decoding footage, drawing scenes in their
 * windows, loading stills, compositing, and encoding (which includes waiting for the encoder to take the frame). */
export type RenderTiming={frames:number;totalMs:number;decodeMs:number;sceneMs:number;stillMs:number;drawMs:number;encodeMs:number;scenes:{asked:number;drawn:number;unchanged:number;repeated:number};cloud?:{scenes:number;failed:number;ms:number}};

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

type CloudScene={fps:number;chunks:{start:number;end:number;video:Blob}[]};
/** Quick render (window.dream.cloudScene, on the web): the export's scenes drawn in the cloud before it starts, all at
 * once; a scene the cloud could not draw (or with no quick render for this account) is drawn here, frame by frame. */
async function cloudScenes(p:ReturnType<typeof prepare>,signal:AbortSignal){
 const ask=(window as any).dream?.cloudScene as ((request:Record<string,unknown>)=>Promise<CloudScene|{unavailable:string}>)|undefined,drawn=new Map<string,CloudScene>();
 const began=performance.now();let failed=0;
 if(!ask)return{drawn,failed,ms:0};
 const used=new Set([...p.resolved.clips.map(c=>c.assetId),...p.resolved.items.flatMap(i=>i.source?[i.source.assetId]:[])]);
 const scenes=[...used].map(id=>p.assets.get(id)).filter((a):a is Asset=>!!a?.scene&&a.scene.format==='engine');
 await Promise.all(scenes.map(async asset=>{const fps=asset.fps||30;
  try{const answer=await ask({assetId:asset.id,width:asset.width,height:asset.height,fps,frames:Math.max(1,Math.round(asset.durationSec*fps)),signal});if('chunks' in answer)drawn.set(asset.id,answer);}
  catch(error){failed++;if(!signal.aborted)console.warn('[export] quick render failed; the scene is drawn here:',(error as Error).message);}}));
 return{drawn,failed,ms:Math.round(performance.now()-began)};
}
/** A cloud-drawn scene's frames, from the piece of WebM holding each; a piece is let go once the export is past it. */
class CloudFrames{
 private open=new Map<string,{chunk:number;input:Input;reader:Reader}>();
 constructor(private scenes:Map<string,CloudScene>){}
 has(assetId:string){return this.scenes.has(assetId);}
 async picture(layer:MediaLayer,asset:Asset){
  const scene=this.scenes.get(asset.id)!,frame=layer.frameIndex??0,found=scene.chunks.findIndex(c=>frame<c.end),n=found<0?scene.chunks.length-1:found,chunk=scene.chunks[n];
  let entry=this.open.get(layer.key);
  if(entry?.chunk!==n){entry?.reader.close();entry?.input.dispose?.();const input=new Input({source:new BlobSource(chunk.video),formats:ALL_FORMATS}),track=await input.getPrimaryVideoTrack();
   if(!track)throw new Error(`Scene ${asset.filename}: quick render sent no frames.`);entry={chunk:n,input,reader:new Reader(new VideoSampleSink(track))};this.open.set(layer.key,entry);}
  const sample=await entry.reader.at((frame-chunk.start)/scene.fps+1e-4);return sample?.toCanvasImageSource();
 }
 close(){for(const {reader,input} of this.open.values()){reader.close();input.dispose?.();}this.open.clear();}
}

export async function renderVideo(job:VideoJob):Promise<RenderTiming>{
 const began=performance.now(),spent={decodeMs:0,sceneMs:0,stillMs:0,drawMs:0,encodeMs:0},since=(at:number)=>performance.now()-at;
 const p=prepare({timeline:job.timeline,footage:job.footage}),total=Math.max(1,Math.round(p.resolved.durationSec*job.fps));
 const canvas=new OffscreenCanvas(job.width,job.height),compositor=new Compositor(canvas);
 const output=new Output({format:job.container==='mov'?new MovOutputFormat():new Mp4OutputFormat(),target:new StreamTarget(new WritableStream({write:chunk=>job.write(chunk.data,chunk.position)}),{chunked:true})});
 const source=new CanvasSource(canvas,{codec:job.codec==='hevc'?'hevc':'avc',bitrate:videoBitrate(job),keyFrameInterval:2,hardwareAcceleration:'prefer-hardware',latencyMode:'quality'});
 output.addVideoTrack(source,{frameRate:job.fps});await output.start();
 const cloud=await cloudScenes(p,job.signal),cloudFrames=new CloudFrames(cloud.drawn);
 const scenes=new SceneCaptures(),inputs=new Map<string,{input:Input;sink:Promise<VideoSampleSink|undefined>}>(),readers=new Map<string,{reader:Reader;last:number}>(),images=new Map<string,ImageBitmap>();
 const sink=(asset:Asset)=>{let entry=inputs.get(asset.id);if(!entry){const input=new Input({source:new UrlSource(originalUrl(asset)),formats:ALL_FORMATS});entry={input,sink:input.getPrimaryVideoTrack().then(async track=>track&&await track.canDecode()?new VideoSampleSink(await decodedAsPlayed(track)):undefined)};inputs.set(asset.id,entry);}return entry.sink;};
 // A source this computer cannot decode (a format WebCodecs does not read) uses the playback copy made at import.
 const fallback=new Map<string,Input>(),playbackSink=async(asset:Asset)=>{let input=fallback.get(asset.id);if(!input){input=new Input({source:new UrlSource(previewUrl(asset)),formats:ALL_FORMATS});fallback.set(asset.id,input);}const track=await input.getPrimaryVideoTrack();return track?new VideoSampleSink(await decodedAsPlayed(track)):undefined;};
 const image=async(url:string)=>{let bitmap=images.get(url);if(!bitmap){bitmap=await createImageBitmap(await (await fetch(url)).blob());images.set(url,bitmap);if(images.size>240){const [first,old]=images.entries().next().value!;old.close();images.delete(first);}}return bitmap;};
 try{
  for(let n=0;n<total;n++){
   job.signal.throwIfAborted();const time=n/job.fps,frame=frameAt(p,time),pictures=new Map<MediaLayer,Picture>();
   for(const layer of frame.layers){if(layer.kind!=='media')continue;const asset=p.assets.get(layer.assetId);if(!asset)continue;const at=performance.now();
    if(layer.media==='video'){let entry=readers.get(layer.key);
     if(!entry){const s=await sink(asset)??await playbackSink(asset);if(!s)throw new Error(`${asset.filename} has no video this computer can decode.`);entry={reader:new Reader(s),last:n};readers.set(layer.key,entry);}
     entry.last=n;const sample=await entry.reader.at(layer.time);if(sample)pictures.set(layer,sample.toCanvasImageSource());spent.decodeMs+=since(at);}
    else if(layer.media==='scene'){const picture=cloudFrames.has(asset.id)?await cloudFrames.picture(layer,asset):await scenes.picture(layer,asset);if(picture)pictures.set(layer,picture);spent.sceneMs+=since(at);}
    else{pictures.set(layer,await image(layer.media==='sequence'?previewUrl(asset)+'&frame='+(layer.frameIndex??0):previewUrl(asset)));spent.stillMs+=since(at);}}
   let at=performance.now();compositor.draw(frame,layer=>pictures.get(layer));spent.drawMs+=since(at);
   at=performance.now();await source.add(time,1/job.fps);spent.encodeMs+=since(at);
   // A clip that has not been drawn for a second is finished with: its decoder is released.
   for(const [key,entry] of readers)if(n-entry.last>job.fps){entry.reader.close();readers.delete(key);}
   if(n%5===0||n===total-1)job.onProgress(n+1,total);
  }
  const at=performance.now();source.close();await output.finalize();spent.encodeMs+=since(at);
  const round=(ms:number)=>Math.round(ms);
  return{frames:total,totalMs:round(since(began)),decodeMs:round(spent.decodeMs),sceneMs:round(spent.sceneMs),stillMs:round(spent.stillMs),drawMs:round(spent.drawMs),encodeMs:round(spent.encodeMs),scenes:{...scenes.counts},cloud:{scenes:cloud.drawn.size,failed:cloud.failed,ms:cloud.ms}};
 }catch(error){await output.cancel().catch(()=>{});throw error;}
 finally{scenes.close();cloudFrames.close();for(const {reader} of readers.values())reader.close();for(const b of images.values())b.close();for(const {input} of inputs.values())input.dispose?.();for(const input of fallback.values())input.dispose?.();compositor.dispose();}
}
