import {prepare,frameAt,Compositor,audioManifest,envelope,type Prepared,type MediaLayer,type AudioSegment,type Frame} from '@dream/compositor';
import type {TimelineDocument} from '@dream/timeline';
import type {FootageIndex,Asset} from '@dream/footage';
import {SceneLayers} from './scenes';
import {upcoming,continues,pickVideo,LOOKAHEAD_SEC} from './lookahead';

/** The preview player: the engine's frames drawn live on a canvas, the way Export draws them. Video comes from muted video
 * elements (decoded on the graphics card), one per clip showing or about to, kept on the frame the timeline asks for; a cut
 * that continues the same shot keeps the playing element on, and a video plays the source's preview copy (a keyframe
 * every half second) when it has one, so a cut into the middle of a clip shows at once. Sound comes from one audio
 * element per sound segment through Web Audio, shaped by the same gain, fade and ducking envelope Export mixes with.
 * Coded motion graphics play live in their own sandboxed documents between two canvases: what lies under the first
 * scene is drawn on the canvas below, what lies over it (titles, captions, overlays) on a transparent canvas above. */
export type PlayerEvent='frameupdate'|'play'|'pause'|'mutechange'|'ended';
export type PlayerRef={seekTo(frame:number):void;play():void;pause():void;toggle():void;isPlaying():boolean;getCurrentFrame():number;mute():void;unmute():void;isMuted():boolean;
 addEventListener(event:PlayerEvent,listener:(e:CustomEvent)=>void):void;removeEventListener(event:PlayerEvent,listener:(e:CustomEvent)=>void):void};

export const previewUrl=(a:Asset)=>'dream-media://'+a.id+'/preview?revision='+encodeURIComponent(a.proxyPath?'proxy':'original');
/** What the preview's video elements play: the source's preview copy when it has one, else what the preview plays. */
export const playUrl=(a:Asset)=>'dream-media://'+a.id+'/play?revision='+encodeURIComponent(a.previewPath?'preview':a.proxyPath?'proxy':'original');
export const audioUrl=(a:Asset)=>'dream-media://'+a.id+'/audio?revision='+encodeURIComponent(a.audioPath?'normalized':a.playback?.audio??'original');

type Video={el:HTMLVideoElement;key:string;assetId:string;url:string;lastUsed:number;seeking:boolean};
type Sound={el:HTMLAudioElement;gain:GainNode;segment:AudioSegment};

export class EnginePlayer implements PlayerRef{
 private compositor:Compositor;private prepared!:Prepared;private segments:AudioSegment[]=[];private fps=30;private duration=1;
 private videos=new Map<string,Video>();private images=new Map<string,HTMLImageElement>();private sounds=new Map<string,Sound>();
 private audio?:AudioContext;private master?:GainNode;private muted=false;private playing=false;private anchor={time:0,at:0};private time=0;private raf=0;private lastDraw=0;private dirty=true;
 private events=new EventTarget();private stopped=false;private lastFrame=-1;
 private scenes?:SceneLayers;private over?:Compositor;private layerCache=new Map<number,MediaLayer[]>();private resized:ResizeObserver;
 constructor(readonly canvas:HTMLCanvasElement,private layers?:{scenes:HTMLElement;overlay:HTMLCanvasElement}){this.compositor=new Compositor(canvas);if(layers)this.scenes=new SceneLayers(layers.scenes);this.loop=this.loop.bind(this);this.raf=requestAnimationFrame(this.loop);
  // A paused frame is drawn again when the preview changes size: the canvas at its new size, and coded scenes placed at
  // the new scale (they kept the old one, so dragging the timeline divider showed more or less of a graphic).
  this.resized=new ResizeObserver(()=>{this.dirty=true;});this.resized.observe(canvas);}
 /** A new revision of the edit: the frames and sound follow it without interrupting playback. */
 setProject(timeline:TimelineDocument,footage:FootageIndex){
  this.prepared=prepare({timeline,footage});this.layerCache.clear();this.fps=timeline.settings.fps;this.duration=Math.max(1/this.fps,this.prepared.resolved.durationSec);
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
 addEventListener(event:PlayerEvent,listener:(e:CustomEvent)=>void){this.events.addEventListener(event,listener as EventListener);}
 removeEventListener(event:PlayerEvent,listener:(e:CustomEvent)=>void){this.events.removeEventListener(event,listener as EventListener);}
 private ensureAudio(){if(this.audio)return;this.audio=new AudioContext({latencyHint:'interactive'});this.master=this.audio.createGain();this.master.gain.value=this.muted?0:1;this.master.connect(this.audio.destination);}

 /** The video element a clip draws from this moment (see pickVideo): its own, one of the same source taken over, or a new one. */
 private video(layer:MediaLayer,claimed:Set<Video>,needed:Set<string>){
  const url=playUrl(this.prepared.assets.get(layer.assetId)!);let v=pickVideo(this.videos.values(),layer,claimed,needed);
  // A video of an older copy of the source (its preview copy has arrived since) is let go for one of the new.
  if(v&&v.url!==url){this.unload(v);v=undefined;}
  const stale=this.videos.get(layer.key);if(stale&&stale!==v)this.unload(stale);
  if(v&&v.key!==layer.key){this.videos.delete(v.key);v.key=layer.key;}
  if(!v){const el=document.createElement('video');el.muted=true;el.playsInline=true;el.preload='auto';el.crossOrigin='anonymous';el.src=url;
   v={el,key:layer.key,assetId:layer.assetId,url,lastUsed:0,seeking:false};const video=v;el.addEventListener('seeked',()=>{video.seeking=false;this.dirty=true;});el.addEventListener('loadeddata',()=>{this.dirty=true;});}
  this.videos.set(layer.key,v);claimed.add(v);v.lastUsed=performance.now();return v;
 }
 private unload(v:Video){v.el.pause();v.el.removeAttribute('src');v.el.load();if(this.videos.get(v.key)===v)this.videos.delete(v.key);}
 /** The media layers (not scenes) a timeline frame shows, worked out once per frame of each revision. */
 private layersAt(frame:number){
  let layers=this.layerCache.get(frame);
  if(!layers){if(this.layerCache.size>4096)this.layerCache.clear();layers=frameAt(this.prepared,frame/this.fps).layers.filter((l):l is MediaLayer=>l.kind==='media'&&l.media!=='scene');this.layerCache.set(frame,layers);}
  return layers;
 }
 /** Keeps a clip's video on the moment the timeline asks for: playing along at the clip's speed, or seeked to the exact
  * frame while paused. A playing video that drifts is eased back by running a little faster or slower, since every seek
  * while playing shows as a hitch; only a video half a second off is seeked. */
 private steer(v:Video,layer:MediaLayer,playing:boolean){
  const el=v.el,frame=1/this.fps;if(el.readyState<1)return;
  if(playing&&layer.rate>0){const drift=layer.time-el.currentTime;
   if(Math.abs(drift)>.5&&!v.seeking){v.seeking=true;el.currentTime=layer.time;}
   const rate=layer.rate*(Math.abs(drift)>frame?1+Math.max(-.1,Math.min(.1,drift)):1);if(Math.abs(el.playbackRate-rate)>.005)el.playbackRate=rate;
   if(el.paused)void el.play().catch(()=>{});}
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
  const tick=performance.now();
  // Every clip that starts within the next second, however short, is loaded and parked on its first frame, so its cut
  // shows at once; one that continues the shot playing into it needs nothing, as the playing video carries on into it.
  const videos=media.filter(l=>l.media==='video'),from=Math.round(time*this.fps),to=Math.round(Math.min(this.duration-1e-3,time+LOOKAHEAD_SEC)*this.fps);
  const arrivals=upcoming(n=>this.layersAt(n),from,to).filter(a=>!media.some(m=>m.key===a.layer.key));
  const needed=new Set([...videos,...arrivals.map(a=>a.layer)].map(l=>l.key)),claimed=new Set<Video>();
  for(const layer of videos)this.steer(this.video(layer,claimed,needed),layer,this.playing);
  for(const arrival of arrivals){const layer=arrival.layer;
   if(layer.media==='video'){if(!(this.playing&&videos.some(l=>continues(l,arrival,time,this.fps))))this.steer(this.video(layer,claimed,needed),layer,false);}
   else if(layer.media==='image'||layer.media==='sequence')this.picture(layer);}
  for(const layer of this.layersAt(to))if(layer.media==='sequence')this.picture(layer);
  this.sound(time);
  // A clip that has left the frame stops playing at once (it would go on decoding unseen), and is let go after a while.
  const now=performance.now();for(const v of [...this.videos.values()]){if(v.lastUsed<tick&&!v.el.paused)v.el.pause();if(now-v.lastUsed>4000)this.unload(v);}
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
  this.scenes.update(scenes,this.prepared.assets,this.canvas.getBoundingClientRect().width/frame.width,this.playing);
  const above=frame.layers.slice(first).filter(l=>!(l.kind==='media'&&l.media==='scene')),overlay=this.layers.overlay;
  if(overlay.width!==this.canvas.width||overlay.height!==this.canvas.height){overlay.width=this.canvas.width;overlay.height=this.canvas.height;}
  this.over??=new Compositor(overlay,{transparent:true});this.over.draw({...frame,background:'transparent',layers:above},l=>this.picture(l));overlay.style.visibility='visible';
 }
 /** The canvas draws at the size it is shown, in device pixels, never above the project's own size. */
 private fit(){const box=this.canvas.getBoundingClientRect(),{width,height}=this.prepared.timeline.settings,k=Math.min(1,(box.width*devicePixelRatio)/width)||1,w=Math.max(2,Math.round(width*k)),h=Math.max(2,Math.round(height*k));if(this.canvas.width!==w||this.canvas.height!==h){this.canvas.width=w;this.canvas.height=h;}}
 redraw(){this.dirty=true;}
 destroy(){this.stopped=true;cancelAnimationFrame(this.raf);this.resized.disconnect();for(const v of this.videos.values()){v.el.pause();v.el.removeAttribute('src');v.el.load();}for(const s of this.sounds.values()){s.el.pause();s.el.removeAttribute('src');}this.videos.clear();this.sounds.clear();void this.audio?.close();this.compositor.dispose();this.over?.dispose();this.scenes?.destroy();}
}
