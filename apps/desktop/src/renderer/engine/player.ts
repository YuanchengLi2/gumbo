import {prepare,frameAt,Compositor,audioManifest,envelope,type Prepared,type MediaLayer,type AudioSegment,type Frame} from '@dream/compositor';
import type {TimelineDocument} from '@dream/timeline';
import type {FootageIndex,Asset} from '@dream/footage';
import {SceneLayers} from './scenes';

/** The preview player: the engine's frames drawn live on a canvas, the way Export draws them. Video comes from one muted
 * video element per clip (decoded on the graphics card), kept on the frame the timeline asks for; sound from one audio
 * element per sound segment through Web Audio, shaped by the same gain, fade and ducking envelope Export mixes with.
 * Coded motion graphics play live in their own sandboxed documents between two canvases: what lies under the first
 * scene is drawn on the canvas below, what lies over it (titles, captions, overlays) on a transparent canvas above. */
export type PlayerEvent='frameupdate'|'play'|'pause'|'mutechange'|'ended';
export type PlayerRef={seekTo(frame:number):void;play():void;pause():void;toggle():void;isPlaying():boolean;getCurrentFrame():number;mute():void;unmute():void;isMuted():boolean;requestFullscreen():void;
 addEventListener(event:PlayerEvent,listener:(e:CustomEvent)=>void):void;removeEventListener(event:PlayerEvent,listener:(e:CustomEvent)=>void):void};

export const previewUrl=(a:Asset)=>'dream-media://'+a.id+'/preview?revision='+encodeURIComponent(a.proxyPath?'proxy':'original');
export const audioUrl=(a:Asset)=>'dream-media://'+a.id+'/audio?revision='+encodeURIComponent(a.audioPath?'normalized':a.playback?.audio??'original');

type Video={el:HTMLVideoElement;assetId:string;lastUsed:number;seeking:boolean};
type Sound={el:HTMLAudioElement;gain:GainNode;segment:AudioSegment};

export class EnginePlayer implements PlayerRef{
 private compositor:Compositor;private prepared!:Prepared;private segments:AudioSegment[]=[];private fps=30;private duration=1;
 private videos=new Map<string,Video>();private images=new Map<string,HTMLImageElement>();private sounds=new Map<string,Sound>();
 private audio?:AudioContext;private master?:GainNode;private muted=false;private playing=false;private anchor={time:0,at:0};private time=0;private raf=0;private lastDraw=0;private dirty=true;
 private events=new EventTarget();private stopped=false;private lastFrame=-1;
 private scenes?:SceneLayers;private over?:Compositor;
 constructor(readonly canvas:HTMLCanvasElement,private layers?:{scenes:HTMLElement;overlay:HTMLCanvasElement}){this.compositor=new Compositor(canvas);if(layers)this.scenes=new SceneLayers(layers.scenes);this.loop=this.loop.bind(this);this.raf=requestAnimationFrame(this.loop);}
 /** A new revision of the edit: the frames and sound follow it without interrupting playback. */
 setProject(timeline:TimelineDocument,footage:FootageIndex){
  this.prepared=prepare({timeline,footage});this.fps=timeline.settings.fps;this.duration=Math.max(1/this.fps,this.prepared.resolved.durationSec);
  this.segments=audioManifest(timeline,footage).filter(s=>s.enabled!==false);
  for(const [id,sound] of this.sounds)if(!this.segments.some(s=>s.id===id&&s.assetId===sound.segment.assetId)){sound.el.pause();sound.gain.disconnect();this.sounds.delete(id);}
  for(const sound of this.sounds.values())sound.segment=this.segments.find(s=>s.id===sound.segment.id)!;
  if(this.time>=this.duration)this.time=Math.max(0,this.duration-1/this.fps);this.dirty=true;
 }
 private emit(event:PlayerEvent,detail:unknown={}){this.events.dispatchEvent(new CustomEvent(event,{detail}));}
 private now(){return this.playing?Math.min(this.duration,this.anchor.time+(performance.now()-this.anchor.at)/1000):this.time;}
 getCurrentFrame(){return Math.min(Math.round(this.duration*this.fps)-1,Math.floor(this.now()*this.fps+1e-6));}
 isPlaying(){return this.playing;}
 seekTo(frame:number){this.time=Math.max(0,Math.min(this.duration-1/this.fps,frame/this.fps));this.anchor={time:this.time,at:performance.now()};this.dirty=true;for(const s of this.sounds.values())s.el.pause();if(!this.playing)this.emit('frameupdate',{frame:this.getCurrentFrame()});}
 play(){if(this.playing)return;if(this.time>=this.duration-1/this.fps)this.time=0;this.ensureAudio();void this.audio?.resume();this.playing=true;this.anchor={time:this.time,at:performance.now()};this.emit('play');}
 pause(){if(!this.playing)return;this.time=this.now();this.playing=false;for(const v of this.videos.values())v.el.pause();for(const s of this.sounds.values())s.el.pause();this.dirty=true;this.emit('pause');}
 toggle(){if(this.playing)this.pause();else this.play();}
 mute(){this.muted=true;if(this.master)this.master.gain.value=0;this.emit('mutechange');}
 unmute(){this.muted=false;if(this.master)this.master.gain.value=1;this.emit('mutechange');}
 isMuted(){return this.muted;}
 requestFullscreen(){void (this.canvas.parentElement??this.canvas).requestFullscreen();}
 addEventListener(event:PlayerEvent,listener:(e:CustomEvent)=>void){this.events.addEventListener(event,listener as EventListener);}
 removeEventListener(event:PlayerEvent,listener:(e:CustomEvent)=>void){this.events.removeEventListener(event,listener as EventListener);}
 private ensureAudio(){if(this.audio)return;this.audio=new AudioContext({latencyHint:'interactive'});this.master=this.audio.createGain();this.master.gain.value=this.muted?0:1;this.master.connect(this.audio.destination);}

 private video(layer:MediaLayer){
  let v=this.videos.get(layer.key);const asset=this.prepared.assets.get(layer.assetId)!;
  if(v&&v.assetId!==layer.assetId){v.el.removeAttribute('src');v.el.load();this.videos.delete(layer.key);v=undefined;}
  if(!v){const el=document.createElement('video');el.muted=true;el.playsInline=true;el.preload='auto';el.crossOrigin='anonymous';el.src=previewUrl(asset);
   v={el,assetId:layer.assetId,lastUsed:0,seeking:false};const video=v;el.addEventListener('seeked',()=>{video.seeking=false;this.dirty=true;});el.addEventListener('loadeddata',()=>{this.dirty=true;});this.videos.set(layer.key,v);}
  v.lastUsed=performance.now();return v;
 }
 /** Keeps a clip's video on the moment the timeline asks for: playing along at the clip's speed, re-synced when it drifts,
  * or seeked to the exact frame while paused. */
 private steer(v:Video,layer:MediaLayer,playing:boolean){
  const el=v.el,frame=1/this.fps;if(el.readyState<1)return;
  if(playing&&layer.rate>0){el.playbackRate=layer.rate;if(Math.abs(el.currentTime-layer.time)>.25&&!v.seeking){v.seeking=true;el.currentTime=layer.time;}if(el.paused)void el.play().catch(()=>{});}
  else{if(!el.paused)el.pause();if(Math.abs(el.currentTime-layer.time)>frame/2&&!v.seeking){v.seeking=true;el.currentTime=layer.time;}}
 }
 private picture(layer:MediaLayer){
  if(layer.media==='video'){const v=this.videos.get(layer.key);return v&&v.el.readyState>=2?v.el:undefined;}
  const asset=this.prepared.assets.get(layer.assetId)!,url=layer.media==='sequence'?previewUrl(asset)+'&frame='+(layer.frameIndex??0):previewUrl(asset);
  let img=this.images.get(url);if(!img){img=new Image();img.crossOrigin='anonymous';img.onload=()=>{this.dirty=true;};img.src=url;this.images.set(url,img);if(this.images.size>240)this.images.delete(this.images.keys().next().value!);}
  return img.complete&&img.naturalWidth?img:undefined;
 }
 private sound(t:number){
  if(!this.audio||!this.master)return;const sample=t*48000,speech=this.prepared.words.some(w=>w.start<=t&&w.end>t);
  for(const segment of this.segments){
   const start=segment.startSample/48000,end=start+segment.durationSamples/48000,active=this.playing&&t>=start&&t<end,soon=this.playing&&t>=start-1&&t<end;
   let s=this.sounds.get(segment.id);if(!soon){if(s&&!s.el.paused)s.el.pause();continue;}
   const asset=this.prepared.assets.get(segment.assetId);if(!asset)continue;
   if(!s){const el=new Audio();el.crossOrigin='anonymous';el.preload='auto';el.src=audioUrl(asset);const gain=this.audio.createGain();this.audio.createMediaElementSource(el).connect(gain);gain.connect(this.master);s={el,gain,segment};this.sounds.set(segment.id,s);
    el.addEventListener('error',()=>window.dispatchEvent(new CustomEvent('dream-audio-error',{detail:{assetId:segment.assetId,message:'The sound could not be loaded.'}})));}
   const at=segment.sourceStartSample/48000+(t-start)*segment.speed;s.gain.gain.setTargetAtTime(active?envelope(segment,sample,speech):0,this.audio.currentTime,.01);
   if(!active){if(!s.el.paused)s.el.pause();if(s.el.readyState>=1&&Math.abs(s.el.currentTime-segment.sourceStartSample/48000)>.05)s.el.currentTime=segment.sourceStartSample/48000;continue;}
   s.el.playbackRate=segment.speed;if(s.el.paused){if(Math.abs(s.el.currentTime-at)>.05)s.el.currentTime=at;void s.el.play().catch(()=>{});}else if(Math.abs(s.el.currentTime-at)>.15)s.el.currentTime=at;
  }
 }
 private loop(){
  if(this.stopped)return;this.raf=requestAnimationFrame(this.loop);if(!this.prepared)return;
  const t=this.now();if(this.playing&&t>=this.duration){this.time=Math.max(0,this.duration-1/this.fps);this.playing=false;for(const v of this.videos.values())v.el.pause();for(const s of this.sounds.values())s.el.pause();this.emit('pause');this.emit('ended');this.dirty=true;}
  const time=this.playing?t:this.time,frame=frameAt(this.prepared,time),media=frame.layers.filter((l):l is MediaLayer=>l.kind==='media');
  const pictured=media.filter(l=>l.media!=='scene');
  for(const layer of media)if(layer.media==='video')this.steer(this.video(layer),layer,this.playing);
  // The next clip is loaded and parked on its first frame half a second early, so a cut shows it at once.
  for(const layer of frameAt(this.prepared,Math.min(this.duration-1e-3,time+.5)).layers)if(layer.kind==='media'&&layer.media==='video'&&!media.some(m=>m.key===layer.key))this.steer(this.video(layer),layer,false);
  else if(layer.kind==='media'&&(layer.media==='image'||layer.media==='sequence'))this.picture(layer);
  this.sound(time);
  const now=performance.now();for(const [key,v] of this.videos)if(now-v.lastUsed>4000){v.el.pause();v.el.removeAttribute('src');v.el.load();this.videos.delete(key);}
  if(this.playing){const n=this.getCurrentFrame();if(n!==this.lastFrame){this.lastFrame=n;this.emit('frameupdate',{frame:n});}this.dirty=true;}
  if(!this.dirty)return;
  // Wait for every picture the frame needs (up to a moment), so a seek or cut never flashes an empty frame.
  const ready=pictured.every(l=>this.picture(l));if(!ready&&now-this.lastDraw<400)return;
  this.fit();this.paint(frame,media);this.lastDraw=now;this.dirty=!ready;
 }
 private paint(frame:Frame,media:MediaLayer[]){
  const first=frame.layers.findIndex(l=>l.kind==='media'&&l.media==='scene'),scenes=media.filter(l=>l.media==='scene');
  if(first<0||!this.scenes||!this.layers){this.compositor.draw(frame,l=>this.picture(l));if(this.layers)this.layers.overlay.style.visibility='hidden';this.scenes?.update([],this.prepared.assets,1);return;}
  this.compositor.draw({...frame,layers:frame.layers.slice(0,first)},l=>this.picture(l));
  this.scenes.update(scenes,this.prepared.assets,this.canvas.getBoundingClientRect().width/frame.width);
  const above=frame.layers.slice(first).filter(l=>!(l.kind==='media'&&l.media==='scene')),overlay=this.layers.overlay;
  if(overlay.width!==this.canvas.width||overlay.height!==this.canvas.height){overlay.width=this.canvas.width;overlay.height=this.canvas.height;}
  this.over??=new Compositor(overlay,{transparent:true});this.over.draw({...frame,background:'transparent',layers:above},l=>this.picture(l));overlay.style.visibility='visible';
 }
 /** The canvas draws at the size it is shown, in device pixels, never above the project's own size. */
 private fit(){const box=this.canvas.getBoundingClientRect(),{width,height}=this.prepared.timeline.settings,k=Math.min(1,(box.width*devicePixelRatio)/width)||1,w=Math.max(2,Math.round(width*k)),h=Math.max(2,Math.round(height*k));if(this.canvas.width!==w||this.canvas.height!==h){this.canvas.width=w;this.canvas.height=h;}}
 redraw(){this.dirty=true;}
 destroy(){this.stopped=true;cancelAnimationFrame(this.raf);for(const v of this.videos.values()){v.el.pause();v.el.removeAttribute('src');v.el.load();}for(const s of this.sounds.values()){s.el.pause();s.el.removeAttribute('src');}this.videos.clear();this.sounds.clear();void this.audio?.close();this.compositor.dispose();this.over?.dispose();this.scenes?.destroy();}
}
