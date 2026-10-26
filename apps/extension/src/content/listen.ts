/// <reference types="chrome" />
import {post,ask} from './port';
import {layer,surface,addStyle} from './ui/root';
import {loadSettings,onSettings,listensOn,saveSettings,type Settings} from '../shared/settings';
import {momentOf} from '../shared/moment';
/** Listening in a page. When something with sound plays here for more than a moment (a video, a talk, a podcast, the
 * other side of a call), its sound is tapped (a copy: what plays is never changed), mixed to mono at 16 kHz and handed to
 * the offscreen document a second at a time with where the video is, which turns it into captions and memory. A video
 * with its own captions sends those instead (they are exact). It stops when the media has been paused for a while,
 * ends, or the page moves on. The top frame shows a small pill while anything in the tab is heard: the latest line,
 * and Stop. Nothing is heard on sites where Gumbo is off, or where listening is turned off. */
const RATE=16000;
type Source={buffer:number[];stop:()=>void;resample:(mono:Float32Array,rate:number)=>void};
type Tap={id:string;el:HTMLMediaElement;kind:'meeting'|'video'|'audio';url:string;sources:Source[];tracks:Set<string>;timer:number;pausedAt:number;seconds:number;zero:number;cues?:TextTrack;sent:Set<string>;restarts:number;flushing?:boolean};
let settings:Settings|undefined,tap:Tap|null=null,starting=false;
/** Sound tapped the moment something starts playing, before it is known to be worth a recording (it plays on for a
 * moment and a half): those first seconds are kept and become the recording's start, so its first words are heard. */
let early:{el:HTMLMediaElement;sources:Source[];tracks:Set<string>}|null=null;
const playingSince=new WeakMap<HTMLMediaElement,number>(),stopped=new WeakSet<HTMLMediaElement>(),deaf=new WeakSet<HTMLMediaElement>(),failedAt=new WeakMap<HTMLMediaElement,number>();
const allowed=()=>!!settings&&listensOn(settings,location.hostname)&&(window===window.top||listensOn(settings,topHost()));
const topHost=()=>{try{return new URL(document.referrer||location.href).hostname;}catch{return location.hostname;}};

export function startListen(){
 void loadSettings().then(s=>{settings=s;scan();});
 onSettings(s=>{settings=s;if(!allowed()){if(tap)end();stopEarly();}});
 for(const type of ['playing','play','volumechange','loadedmetadata'])document.addEventListener(type,()=>{setTimeout(scan,0);setTimeout(scan,1600);},true);
 setInterval(scan,2500);
 window.addEventListener('pagehide',()=>{if(tap)end();stopEarly();});
 chrome.runtime.onMessage.addListener((message,sender,reply)=>{
  if(sender.id!==chrome.runtime.id)return;
  if(message?.type==='listen.halt'){if(tap&&tap.id===message.session){stopped.add(tap.el);halt();}return;}
  if(message?.type==='listen.kind'&&window===window.top){reply({kind:[...document.querySelectorAll('video,audio')].some(e=>(e as HTMLMediaElement).srcObject instanceof MediaStream)?'meeting':'video'});return;}
  if(message?.type==='captions'&&window===window.top){pill(message);return;}
  if(message?.type==='listen.seek'){const el=mainMedia();if(el){el.currentTime=message.at;if(el.paused)void el.play().catch(()=>{});reply({ok:true});}return;}
 });
 if(window===window.top){void seekToMoment();window.addEventListener('hashchange',()=>void seekToMoment());}
}

const audible=(el:HTMLMediaElement)=>!el.paused&&!el.ended&&!el.muted&&el.volume>0&&el.readyState>=2;
const kindOf=(el:HTMLMediaElement):Tap['kind']=>el.srcObject instanceof MediaStream?'meeting':el instanceof HTMLVideoElement&&el.videoWidth>0?'video':'audio';
function worthHearing(el:HTMLMediaElement){
 // Media that could not be started is tried again a minute later, not on every scan.
 if(!audible(el)||stopped.has(el)||deaf.has(el)||Date.now()-(failedAt.get(el)??0)<60_000)return false;
 if(el.srcObject instanceof MediaStream)return el.srcObject.getAudioTracks().length>0;
 // A short sound (a notification, a preview) is not worth remembering; a stream with no end is.
 return !Number.isFinite(el.duration)||el.duration>=20;
}
function scan(){
 if(!allowed()||starting)return;
 const now=Date.now(),media=[...document.querySelectorAll('video,audio')] as HTMLMediaElement[];
 for(const el of media){if(worthHearing(el)){if(!playingSince.has(el))playingSince.set(el,now);}else playingSince.delete(el);}
 if(tap){
  // A call adds a voice as an element of its own: it joins the mix.
  if(tap.kind==='meeting')for(const el of media)if(el.srcObject instanceof MediaStream&&audible(el))for(const t of el.srcObject.getAudioTracks())addTrack(tap,t);
  return;
 }
 // The one to hear: a call first, then the biggest video on screen.
 const area=(el:HTMLMediaElement)=>{const r=el.getBoundingClientRect();return r.width*r.height;};
 const candidates=media.filter(worthHearing).sort((a,b)=>Number(b.srcObject instanceof MediaStream)-Number(a.srcObject instanceof MediaStream)||area(b)-area(a));
 if(early&&!candidates.includes(early.el)){stopEarly();}
 if(!early&&candidates[0]&&!captionsOf(candidates[0]))startEarly(candidates[0]);
 const ready=candidates.filter(el=>now-(playingSince.get(el)??now)>=1500);
 if(ready.length)void begin(early&&ready.includes(early.el)?early.el:ready[0]);
}
function startEarly(el:HTMLMediaElement){
 const holder={sources:[] as Source[],tracks:new Set<string>()};
 if(el.srcObject instanceof MediaStream){for(const track of el.srcObject.getAudioTracks())addTrack(holder,track);}
 else{
  let stream:MediaStream;
  try{stream=(el as any).captureStream();}catch{deafTo(el);return;}
  for(const track of stream.getAudioTracks())addTrack(holder,track);
  stream.addEventListener('addtrack',e=>{if(e.track.kind==='audio'&&(early?.el===el||tap?.el===el))addTrack(tap?.el===el?tap:holder,e.track);});
 }
 early={el,...holder};
}
function stopEarly(){for(const s of early?.sources??[])s.stop();early=null;}

async function begin(el:HTMLMediaElement,restarts=0){
 starting=true;
 try{
  const id=crypto.randomUUID(),kind=kindOf(el),cues=captionsOf(el);
  const reply=await ask<{ok:boolean;reason?:string}>({type:'listen.begin',id,kind,title:document.title,source:cues?'cues':'page'},'listen.started',10_000);
  if(!reply?.ok){if(reply?.reason==='off'||reply?.reason==='busy')stopped.add(el);else failedAt.set(el,Date.now());if(early?.el===el)stopEarly();return;}
  const t:Tap={id,el,kind,url:location.href,sources:[],tracks:new Set(),timer:0,pausedAt:0,seconds:0,zero:0,sent:new Set(),restarts};
  tap=t;
  // What was tapped while it was being decided carries on as this recording, its first seconds included.
  if(early?.el===el&&!cues){t.sources=early.sources;t.tracks=early.tracks;early=null;}
  else if(early)stopEarly();
  if(cues){t.cues=cues;cues.addEventListener('cuechange',sendCues);}
  else if(t.sources.length){/* already tapped */}
  else if(el.srcObject instanceof MediaStream){for(const track of el.srcObject.getAudioTracks())addTrack(t,track);}
  else{
   let stream:MediaStream;
   try{stream=(el as any).captureStream();}catch{deafTo(el);return;}
   for(const track of stream.getAudioTracks())addTrack(t,track);
   stream.addEventListener('addtrack',e=>{if(e.track.kind==='audio'&&tap===t)addTrack(t,e.track);});
  }
  t.timer=setInterval(()=>void flush(t),1000) as unknown as number;
 }finally{starting=false;}
}
/** The video's own captions, when it has a track of them with lines in it (shown or not). */
function captionsOf(el:HTMLMediaElement):TextTrack|undefined{
 for(const track of Array.from(el.textTracks??[]))if((track.kind==='captions'||track.kind==='subtitles')&&track.mode!=='disabled'&&track.cues&&track.cues.length>0)return track;
}
function sendCues(){
 const t=tap;if(!t?.cues?.activeCues)return;
 const cues=[...Array.from(t.cues.activeCues)].map(c=>({start:c.startTime,end:c.endTime,text:(c as VTTCue).text??''})).filter(c=>{const key=`${c.start}|${c.text}`;if(t.sent.has(key))return false;t.sent.add(key);return true;});
 if(cues.length)void chrome.runtime.sendMessage({target:'offscreen',type:'listen.cues',session:t.id,cues}).catch(()=>{});
}
function addTrack(t:{sources:Source[];tracks:Set<string>},track:MediaStreamTrack){
 if(t.tracks.has(track.id)||track.readyState==='ended')return;t.tracks.add(track.id);
 // A copy of the track, so stopping ours never stops the page's.
 const copy=track.clone(),source:Source={buffer:[],stop:()=>{},resample:()=>{}};
 let pos=0,acc=0,n=0;
 source.resample=(mono,rate)=>{
  // Down to 16 kHz by averaging each step's samples (a box filter keeps speech clear and costs nothing).
  const ratio=rate/RATE;for(let i=0;i<mono.length;i++){acc+=mono[i];n++;pos+=1;if(pos>=ratio){source.buffer.push(acc/n);acc=0;n=0;pos-=ratio;}}
  if(source.buffer.length>RATE*12)source.buffer.splice(0,source.buffer.length-RATE*12);
 };
 source.stop=read(copy,source.resample);t.sources.push(source);
}
/** Reads a track's audio as mono frames: MediaStreamTrackProcessor where Chrome has it (no audio context, so no autoplay
 * rules), else a ScriptProcessor. */
function read(track:MediaStreamTrack,onPcm:(mono:Float32Array,rate:number)=>void):()=>void{
 const Processor=(window as any).MediaStreamTrackProcessor;
 if(Processor){
  const reader=new Processor({track}).readable.getReader();let live=true;
  void(async()=>{
   while(live){
    const {value,done}=await reader.read();if(done)break;
    const frame=value as AudioData;
    try{const n=frame.numberOfFrames,channels=frame.numberOfChannels,mono=new Float32Array(n),plane=new Float32Array(n);
     for(let c=0;c<channels;c++){frame.copyTo(plane,{planeIndex:c,format:'f32-planar'});for(let i=0;i<n;i++)mono[i]+=plane[i]/channels;}
     onPcm(mono,frame.sampleRate);}
    catch{}finally{frame.close();}
   }
  })().catch(()=>{});
  return()=>{live=false;void reader.cancel().catch(()=>{});track.stop();};
 }
 const context=new AudioContext(),input=context.createMediaStreamSource(new MediaStream([track])),node=context.createScriptProcessor(4096,2,1);
 node.onaudioprocess=e=>{const b=e.inputBuffer,mono=new Float32Array(b.length);for(let c=0;c<b.numberOfChannels;c++){const d=b.getChannelData(c);for(let i=0;i<d.length;i++)mono[i]+=d[i]/b.numberOfChannels;}onPcm(mono,b.sampleRate);};
 input.connect(node);node.connect(context.destination);
 return()=>{node.disconnect();input.disconnect();void context.close();track.stop();};
}

async function flush(t:Tap){
 if(tap!==t)return;
 const el=t.el;
 if(!el.isConnected||location.href!==t.url&&t.kind!=='meeting'){end();return;}
 if(el.paused||el.ended||el.muted){
  t.pausedAt||=Date.now();for(const s of t.sources)s.buffer.length=0;
  if(Date.now()-t.pausedAt>(el.ended?8000:45_000))end();
  return;
 }
 t.pausedAt=0;
 if(t.cues||t.flushing)return;
 t.flushing=true;
 try{
  // Everything waiting goes, a second at a time and in order (the first seconds, tapped early, go at once).
  for(let waiting=Math.max(0,...t.sources.map(s=>s.buffer.length));waiting>=RATE/2&&tap===t;waiting=Math.max(0,...t.sources.map(s=>s.buffer.length))){
   const n=Math.min(RATE,waiting),mix=new Float32Array(n);
   // Where in the video this second began: the playhead, less everything still waiting.
   const at=t.kind==='meeting'?undefined:Math.max(0,el.currentTime-waiting/RATE*el.playbackRate);
   for(const s of t.sources){const part=s.buffer.splice(0,n);for(let i=0;i<part.length;i++)mix[i]+=part[i];}
   let energy=0;for(const v of mix)energy+=v*v;energy/=n;
   t.seconds++;if(energy<1e-9)t.zero++;
   // Sound that plays but cannot be heard (a video from another site, or one that is protected) comes out as silence.
   if(t.seconds>=20&&t.zero===t.seconds){deafTo(el);return;}
   const ints=new Int16Array(n);for(let i=0;i<n;i++)ints[i]=Math.max(-32768,Math.min(32767,Math.round(mix[i]*32767)));
   const answer=await chrome.runtime.sendMessage({target:'offscreen',type:'listen.audio',session:t.id,pcm:base64(new Uint8Array(ints.buffer)),at,rate:el.playbackRate}).catch(()=>undefined);
   // The offscreen document went away (Chrome closed it, or it restarted): listening starts again, as a new recording.
   if(tap===t&&!answer?.ok){if(t.restarts<3){halt();void begin(el,t.restarts+1);}return;}
  }
 }finally{t.flushing=false;}
}
function base64(bytes:Uint8Array){let s='';for(let i=0;i<bytes.length;i+=0x8000)s+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(s);}
function deafTo(el:HTMLMediaElement){
 deaf.add(el);const was=tap;halt();if(was)post({type:'listen.end',session:was.id});
 post({type:'listen.hint',text:'Gumbo can’t hear this one from the page. Press Alt+Shift+L to listen to the whole tab.'});
}
function end(){const was=tap;halt();if(was)post({type:'listen.end',session:was.id});}
function halt(){const t=tap;if(!t)return;tap=null;clearInterval(t.timer);t.cues?.removeEventListener('cuechange',sendCues);for(const s of t.sources)s.stop();}

/** The page's main media: the one being heard, else the biggest that has loaded. */
function mainMedia(){return tap?.el??([...document.querySelectorAll('video,audio')] as HTMLMediaElement[]).filter(e=>e.readyState>=1).sort((a,b)=>b.getBoundingClientRect().width-a.getBoundingClientRect().width)[0];}
/** A link to a moment (#gumbo-t=95): the page's main video jumps there once it can. */
async function seekToMoment(){
 const at=momentOf(location.hash);if(at===undefined)return;
 history.replaceState(history.state,'',location.href.replace(/#gumbo-t=\d+$/,''));
 for(let tries=0;tries<30;tries++){
  const el=mainMedia();
  if(el){el.currentTime=at;return;}
  await new Promise(r=>setTimeout(r,500));
 }
}

// The pill, in the top frame.
let pillEl:HTMLDivElement|null=null,pillSession='',quiet:number|undefined,styled=false;
const css=`
.listen{position:fixed;left:16px;bottom:16px;pointer-events:auto;max-width:min(560px,calc(100vw - 32px));display:flex;gap:8px;align-items:center;padding:6px 6px 6px 11px;border-radius:999px;font:12.5px/1.35 "Segoe UI Variable Text","Segoe UI",system-ui,-apple-system,sans-serif;color:#1d1d1d;background:rgba(255,255,255,.97);border:1px solid rgba(0,0,0,.1);box-shadow:0 6px 24px rgba(0,0,0,.12),0 1px 3px rgba(0,0,0,.08);animation:in .14s ease-out;transition:opacity .3s}
.listen .dot{flex:none;width:7px;height:7px;border-radius:50%;background:#1d1d1d;animation:breathe 1.8s ease-in-out infinite}
.listen .line{min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis;color:#555}
.listen .line b{color:#1d1d1d;font-weight:600}
.listen .line .now{opacity:.7}
.listen button{all:unset;flex:none;cursor:pointer;color:#666;padding:2px 8px;border-radius:999px;font:inherit}
.listen button:hover{color:#000;background:rgba(0,0,0,.06)}
.listen .never{display:none}.listen:hover .never{display:inline-block}
.listen.hint .dot{animation:none;background:#999}
@keyframes breathe{0%,100%{opacity:1}50%{opacity:.35}}
@media (prefers-color-scheme:dark){.listen{color:#eee;background:rgba(35,35,35,.97);border-color:rgba(255,255,255,.12)}.listen .dot{background:#eee}.listen .line{color:#bbb}.listen .line b{color:#fff}.listen button{color:#aaa}.listen button:hover{color:#fff;background:rgba(255,255,255,.08)}}
`;
function pill(m:{session?:string;title?:string;segment?:{speaker:string;text:string};partial?:{speaker:string;text:string};progress?:number;ended?:boolean;lines?:number;started?:boolean;hint?:string}){
 if(!styled){layer();addStyle(css);styled=true;}
 if(m.hint){show('',m.hint,true);clearTimeout(quiet);quiet=setTimeout(hide,9000) as unknown as number;return;}
 if(m.ended){if(m.session===pillSession&&!pillEl?.classList.contains('hint')){if(m.lines===0){hide();return;}show(pillSession,'Saved to memory');clearTimeout(quiet);quiet=setTimeout(hide,2200) as unknown as number;}return;}
 if(!m.session)return;
 // What is being said right now, as it is said: its newest words (a lighter shade until they are a line).
 if(m.partial){
  if(!m.partial.text)return;
  const t=m.partial.text.length>110?'…'+m.partial.text.slice(-110).replace(/^\S*\s/,''):m.partial.text;
  show(m.session,`${m.partial.speaker?`<b>${escape(m.partial.speaker)}</b>  `:''}<span class="now">${escape(t)}</span>`,false,true);
  clearTimeout(quiet);quiet=setTimeout(()=>{const l=pillEl?.querySelector('.line');if(l)l.innerHTML='Listening';},7000) as unknown as number;
  return;
 }
 const line=m.progress!==undefined&&m.progress<100?`Getting ready to listen · ${m.progress}%`:m.segment?`${m.segment.speaker?`<b>${escape(m.segment.speaker)}</b>  `:''}${escape(m.segment.text)}`:'';
 show(m.session,line,false,!!m.segment);
 // After a few seconds without a new line, the pill shrinks to the dot and Stop.
 clearTimeout(quiet);quiet=setTimeout(()=>{const l=pillEl?.querySelector('.line');if(l)l.innerHTML='Listening';},7000) as unknown as number;
}
function show(session:string,line:string,hint=false,html=false){
 pillSession=session||pillSession;
 if(!pillEl||!pillEl.isConnected){
  pillEl=document.createElement('div');pillEl.className='listen';pillEl.setAttribute('role','status');
  pillEl.innerHTML='<span class="dot"></span><span class="line"></span><button class="stop" title="Stop listening (what was heard stays in memory)">Stop</button><button class="never" title="Never listen on this site">Not here</button>';
  pillEl.querySelector('.stop')!.addEventListener('click',()=>{post({type:'listen.stop',session:pillSession});hide();});
  pillEl.querySelector('.never')!.addEventListener('click',()=>{post({type:'listen.stop',session:pillSession});if(settings)void saveSettings({listenOff:[...new Set([...settings.listenOff,location.hostname.replace(/^www\./,'')])]});hide();});
  surface().appendChild(pillEl);
 }
 pillEl.classList.toggle('hint',hint);
 (pillEl.querySelector('.stop') as HTMLElement).style.display=hint?'none':'';(pillEl.querySelector('.never') as HTMLElement).style.display=hint?'none':'';
 const l=pillEl.querySelector('.line')!;if(html)l.innerHTML=line;else l.textContent=line||'Listening';
}
function hide(){pillEl?.remove();pillEl=null;pillSession='';}
const escape=(s:string)=>s.replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]!));
export const listenState=()=>({listening:!!tap,session:tap?.id,kind:tap?.kind,pill:pillEl?.querySelector('.line')?.textContent??null});
