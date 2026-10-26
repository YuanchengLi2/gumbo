/// <reference types="chrome" />
import {LocalWhisper,type LocalWord,type Override} from '@dream/web-ml';
import {add,allVoices,removeMedia,type Media,type Segment,type Voice} from '../background/db';
import {upsertMedia} from './memory';
import {power} from './power';
/** Listening, in the offscreen document. Audio arrives at 16 kHz (from a page's own media, from the whole tab, from the
 * microphone) and Whisper turns it into words in live windows of eight seconds; the words are grouped into what each
 * person said (a sentence, or up to a pause), labelled with who said it (the microphone is "You"; other voices by their
 * fingerprint: a name the user gave that voice before, else "Speaker 1", "Speaker 2"…), and noted with the sounds around
 * them (laughter, applause, music). A video's lines carry the video's own time, so a citation can jump to the moment.
 * Each line goes out as a caption and into memory as it is said; the audio itself is never kept. When the computer
 * cannot keep up (or the model is still loading), the sound waits in a queue and is caught up on, and the next listen
 * uses the smaller model. */
type Stream={push:(pcm:Float32Array)=>Promise<void>;end:()=>Promise<unknown>;cancel:()=>void};
type Feed={stream?:Stream;speaker?:string;pending:LocalWord[];work:Promise<void>;ring:Int16Array;received:number;pushed:number;
 /** Seconds skipped while Whisper was behind, at the Whisper time they were skipped (to map its times back). */gaps:{at:number;skipped:number}[];
 /** Sound waiting for Whisper (samples), and whether its first words came (the model is loaded). */
 backlog:Int16Array[];waiting:number;pumping:boolean;ready:boolean;nextSounds:number;
 /** Where the stream is in the video (for page media): from a stream second to the video's second. */times:{stream:number;media:number;rate:number}[];
 held:{segment:Segment;timer:number}[];audio?:{close:()=>void};
 /** Live captions: where Whisper's settled words end (its time), a quick guess at what was said since, and that guess's
 * state (one at a time, not too often, and never again on a computer where it is slow). */
 settled:number;tail:string;sent:string;guessing:boolean;guessedAt:number;slow:boolean};
type Cluster={centroid:Float32Array;count:number;name:string};
type Live={id:string;media:Media;source:'page'|'tab'|'cues';fake:boolean;feeds:Feed[];clusters:Cluster[];voices:Voice[];lastSave:number;lastAudio:number;
 /** What was said lately on each feed, to drop the microphone's copy of a voice the speakers played. */recent:{feed:Feed;words:Set<string>;at:number}[];ending?:Promise<unknown>};
const RATE=16000,RING=RATE*300,sessions=new Map<string,Live>();
// Live, the base model: "small" knows a little more but only keeps up with long windows (on an Intel Iris Xe it fell
// behind and dropped words at 8-second windows: 27% of words wrong against 7.5% for base).
// And full precision on the GPU: in half precision the same Iris Xe dropped whole phrases (53% of words wrong).
const OVERRIDE:Override={size:'base',fullPrecision:true};
let whisper:LocalWhisper|undefined,gpu:boolean|undefined,lighter=false,soundWorker:Worker|undefined,soundSeq=1;const soundWaiting=new Map<number,(r:any)=>void>();
export const listening=()=>sessions.size>0;
/** What listening did lately, for debugging (the offscreen document has no console anyone sees). */
export const log:string[]=[];
const note=(line:string)=>{log.push(`${new Date().toISOString().slice(11,19)} ${line}`);if(log.length>300)log.splice(0,100);};
const tell=(message:Record<string,unknown>)=>{void chrome.runtime.sendMessage(message).catch(()=>{});};

function sound<T>(type:'voice'|'sounds',pcm:Float32Array):Promise<T|null>{
 if(pcm.length<RATE/2)return Promise.resolve(null);
 soundWorker??=Object.assign(new Worker(chrome.runtime.getURL('sound.js'),{type:'module'}),{onmessage:(e:MessageEvent<any>)=>{soundWaiting.get(e.data.id)?.(e.data);soundWaiting.delete(e.data.id);}});
 const id=soundSeq++;return new Promise(resolve=>{soundWaiting.set(id,(r)=>resolve(r.error?null:(type==='voice'?r.vector:r.sounds)));soundWorker!.postMessage({id,type,pcm});setTimeout(()=>{if(soundWaiting.delete(id))resolve(null);},20_000);});
}

export async function startListening(m:{session:string;kind:Media['kind'];title:string;url:string;site:string;source:Live['source'];streamId?:string;mic?:boolean;fake?:string[]}){
 if(sessions.has(m.session))return{ok:true};
 if(sessions.size>=3)return{ok:false,reason:'busy'};
 if(!m.fake&&m.source!=='cues'&&gpu===undefined){
  whisper??=new LocalWhisper(new Worker(chrome.runtime.getURL('whisper.js'),{type:'module'}),{wasmPaths:chrome.runtime.getURL('ort/')});
  gpu=await whisper.capabilities().then(r=>{note(`whisper ${r.choice.size} on ${r.choice.device} (${r.capabilities.adapter?`${r.capabilities.adapter.vendor} ${r.capabilities.adapter.architecture}${r.capabilities.adapter.fallback?', fallback':''}`:'no GPU'})`);return r.choice.device==='webgpu';}).catch(()=>false);
 }
 const media:Media={id:m.session,url:m.url,site:m.site,title:m.title||m.url,kind:m.kind,startedAt:Date.now(),segments:[],sounds:[],source:'audio'};
 const live:Live={id:m.session,media,source:m.source,fake:!!m.fake,feeds:[],clusters:[],voices:await allVoices().catch(()=>[]),lastSave:0,lastAudio:Date.now(),recent:[]};
 sessions.set(m.session,live);
 try{
  // Memory must be able to keep it before anything is heard (it is sealed with the account's key).
  await add('media',media);
  const main=feed(live,m.source==='cues'?'none':m.fake);live.feeds.push(main);
  if(m.source==='tab'&&m.streamId){
   // The whole tab: its sound keeps playing for the user while a copy is heard here.
   const stream=await navigator.mediaDevices.getUserMedia({audio:{mandatory:{chromeMediaSource:'tab',chromeMediaSourceId:m.streamId}}} as any);
   const playback=new AudioContext();playback.createMediaStreamSource(stream).connect(playback.destination);
   const tap=await capture(stream,pcm=>{live.lastAudio=Date.now();void hear(live,main,pcm);});
   stream.getAudioTracks()[0]?.addEventListener('ended',()=>void stopListening(live.id));
   main.audio={close:()=>{tap.close();void playback.close();stream.getTracks().forEach(t=>t.stop());}};
  }
  if(m.mic&&await micAllowed()){
   // The user's own side of a call.
   const you=feed(live,m.fake?[]:undefined,'You');live.feeds.push(you);
   const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});
   const tap=await capture(stream,pcm=>void hear(live,you,pcm));
   you.audio={close:()=>{tap.close();stream.getTracks().forEach(t=>t.stop());}};
  }
 }catch(error){sessions.delete(m.session);for(const f of live.feeds){f.audio?.close();f.stream?.cancel();}note(`could not start: ${(error as Error).message}`);return{ok:false,reason:(error as Error).message};}
 return{ok:true};
}
async function micAllowed(){try{return(await navigator.permissions.query({name:'microphone' as PermissionName})).state==='granted';}catch{return false;}}
/** A MediaStream heard at 16 kHz mono, a second at a time. */
async function capture(stream:MediaStream,onPcm:(pcm:Float32Array)=>void){
 const context=new AudioContext({sampleRate:RATE});
 await context.audioWorklet.addModule(chrome.runtime.getURL('pcm-worklet.js'));
 const node=new AudioWorkletNode(context,'gumbo-pcm');node.port.onmessage=e=>onPcm(e.data as Float32Array);
 context.createMediaStreamSource(stream).connect(node);
 return{close:()=>{node.disconnect();void context.close();}};
}

function feed(live:Live,fake?:string[]|'none',speaker?:string):Feed{
 const f:Feed={speaker,pending:[],work:Promise.resolve(),ring:new Int16Array(RING),received:0,pushed:0,gaps:[],backlog:[],waiting:0,pumping:false,ready:false,nextSounds:10,times:[],held:[],settled:0,tail:'',sent:'',guessing:false,guessedAt:0,slow:false};
 // Words are settled in order, one batch after another, so lines never interleave.
 const onWords=(words:LocalWord[])=>{if(words.length){f.settled=words.at(-1)!.end;f.tail='';}f.work=f.work.then(()=>heardWords(live,f,words)).catch(()=>{});};
 if(fake==='none')return f;
 if(fake)f.stream=fakeStream(fake,onWords);
 else{
  whisper??=new LocalWhisper(new Worker(chrome.runtime.getURL('whisper.js'),{type:'module'}),{wasmPaths:chrome.runtime.getURL('ort/')});
  // Whisper reads 30 seconds for every window however short, so short windows (captions sooner) cost more and know less:
  // 8 seconds where a GPU makes that cheap, 16 on WebAssembly, and longer again on a computer that fell behind before.
  const windowSec=Math.min(28,(gpu?8:16)+(lighter?8:0));
  const stream=whisper.stream({windowSec,overlapSec:2,highWaterSec:30,override:OVERRIDE,onWords,onProgress:p=>{if(p.stage==='download')tell({type:'listen.progress',session:live.id,percent:Math.round(p.loaded/Math.max(1,p.total)*100)});}});
  // Whisper could not start (no model, no memory): the user is told, and it is logged, instead of listening to nothing.
  stream.result.catch(error=>{if((error as Error)?.name!=='AbortError')fail(live,error);});
  f.stream=stream as unknown as Stream;note(`stream ${live.id.slice(0,8)} ${speaker??'main'}${lighter?' (lighter)':''}`);
 }
 return f;
}
export async function listenAudio(m:{session:string;pcm:string;at?:number;rate?:number}){
 const live=sessions.get(m.session);if(!live){note(`audio for an unknown session ${m.session.slice(0,8)}`);return{ok:false};}
 const bytes=Uint8Array.from(atob(m.pcm),c=>c.charCodeAt(0)),ints=new Int16Array(bytes.buffer),pcm=new Float32Array(ints.length);
 for(let i=0;i<ints.length;i++)pcm[i]=ints[i]/32768;
 const f=live.feeds[0];live.lastAudio=Date.now();
 if(m.at!==undefined)mark(f,m.at,m.rate??1);
 void hear(live,f,pcm);return{ok:true};
}
/** Notes where the video is: a new mark only when it jumped (a seek, an ad, a change of speed). */
function mark(f:Feed,at:number,rate:number){
 const now=f.received/RATE,last=f.times.at(-1);
 if(!last||last.rate!==rate||Math.abs(last.media+(now-last.stream)*last.rate-at)>1.2)f.times.push({stream:now,media:at,rate});
 if(f.times.length>4000)f.times.splice(0,1000);
}
function mediaTime(f:Feed,t:number){
 let e=f.times[0];if(!e)return t;
 for(let i=f.times.length-1;i>=0;i--)if(f.times[i].stream<=t){e=f.times[i];break;}
 return Math.max(0,e.media+(t-e.stream)*e.rate);
}
async function hear(live:Live,f:Feed,pcm:Float32Array){
 // The last five minutes stay in a ring, to fingerprint voices and hear sounds (also when Whisper is behind); nothing
 // older is kept.
 for(let i=0;i<pcm.length;i++)f.ring[(f.received+i)%RING]=Math.max(-32768,Math.min(32767,Math.round(pcm[i]*32767)));
 f.received+=pcm.length;
 const seconds=f.received/RATE;
 // The sounds around speech (laughter, applause, music): every ten seconds, every thirty on battery, not on a low one.
 if(seconds>=f.nextSounds&&!f.speaker&&!live.fake){const p=power();f.nextSounds=seconds+(p==='full'?10:30);if(p!=='low')void sounds(live,f,seconds);}
 if(!f.stream)return;
 // Nothing said is lost while Whisper loads or falls behind: the sound waits in a queue (as 16-bit, up to twenty
 // minutes) and is caught up on; only past that does the oldest waiting sound go, its time kept so later lines stay right.
 const ints=new Int16Array(pcm.length);for(let i=0;i<pcm.length;i++)ints[i]=Math.max(-32768,Math.min(32767,Math.round(pcm[i]*32767)));
 f.backlog.push(ints);f.waiting+=ints.length;
 while(f.waiting>RATE*1200){const old=f.backlog.shift()!;f.waiting-=old.length;skip(f,old.length);lighter=true;}
 if(!f.pumping)void pump(f);
 guessTail(live,f);
}
/** Live captions, before Whisper's window closes: on a GPU, every second and a half, the sound since the last settled
 * word (up to fourteen seconds) is heard once on its own and shown as a guess, replaced by the real lines as they come.
 * Only while Whisper is keeping up, and never again in a session where one guess took over a second. */
function guessTail(live:Live,f:Feed){
 if(!whisper||!gpu||live.fake||!f.stream||!f.ready||f.guessing||f.slow||power()!=='full'||f.waiting>RATE*2||Date.now()-f.guessedAt<1500)return;
 const to=f.received/RATE,from=Math.max(streamTime(f,f.settled),to-14);if(to-from<1.2)return;
 const pcm=audioAt(f,from,to);let energy=0;for(let i=0;i<pcm.length;i+=4)energy+=pcm[i]*pcm[i];if(energy/(pcm.length/4)<1e-5)return;
 f.guessing=true;const started=performance.now(),settled=f.settled;
 whisper.transcribe(pcm,{override:OVERRIDE,windowSec:Math.min(28,Math.ceil(to-from)+2),overlapSec:0}).then(r=>{
  if(performance.now()-started>1200){f.slow=true;note(`live captions off: a guess took ${Math.round(performance.now()-started)} ms`);}
  // Words settled meanwhile: this guess is about sound that is already in lines.
  if(f.settled===settled){f.tail=r.words.map(w=>w.word).join(' ');partial(live,f);}
 }).catch(()=>{}).finally(()=>{f.guessing=false;f.guessedAt=Date.now();});
}
/** What is being said right now, unfinished: the words not yet in a line, and the guess past them. */
function partial(live:Live,f:Feed){
 const text=[...f.pending.map(w=>w.word),f.tail].join(' ').replace(/\s+([,.;:!?…])/g,'$1').replace(/\s+/g,' ').trim();
 if(text===f.sent)return;f.sent=text;
 tell({type:'listen.partial',session:live.id,speaker:f.speaker??live.clusters.at(-1)?.name??'',text,title:live.media.title});
}
function skip(f:Feed,samples:number){const at=f.pushed/RATE,last=f.gaps.at(-1);if(last&&last.at===at)last.skipped+=samples/RATE;else f.gaps.push({at,skipped:samples/RATE});}
/** Feeds the queue to Whisper as fast as it takes it; a queue that keeps growing past a minute means this computer needs
 * the smaller model next time. */
async function pump(f:Feed){
 f.pumping=true;
 try{
  while(f.backlog.length&&f.stream){
   const ints=f.backlog.shift()!;f.waiting-=ints.length;f.pushed+=ints.length;
   const pcm=new Float32Array(ints.length);for(let i=0;i<ints.length;i++)pcm[i]=ints[i]/32768;
   await f.stream.push(pcm).catch(()=>{});
   if(f.waiting>RATE*60&&f.ready)lighter=true;
  }
 }finally{f.pumping=false;}
}
/** A Whisper time (which has no skipped seconds) as a time in the stream. */
function streamTime(f:Feed,t:number){let s=t;for(const g of f.gaps){if(g.at<=t)s+=g.skipped;else break;}return s;}
function audioAt(f:Feed,start:number,end:number){
 const from=Math.max(Math.floor(start*RATE),f.received-RING,0),to=Math.min(Math.ceil(end*RATE),f.received);
 const out=new Float32Array(Math.max(0,to-from));for(let i=0;i<out.length;i++)out[i]=f.ring[(from+i)%RING]/32768;return out;
}
async function sounds(live:Live,f:Feed,now:number){
 const found=await sound<{label:string;at:number}[]>('sounds',audioAt(f,now-10,now));
 for(const s of found??[]){const at=Math.round(mediaTime(f,now-10+s.at)*10)/10;if(!live.media.sounds.some(x=>x.label===s.label&&Math.abs(x.at-at)<8))live.media.sounds.push({at,label:s.label});}
}

/** Words become lines: a sentence that ended, or up to a pause of almost a second, or at most eighteen seconds. */
async function heardWords(live:Live,f:Feed,words:LocalWord[]){
 f.ready=true;note(`${words.length} words ${live.id.slice(0,8)} at ${words[0]?.start?.toFixed(1)}, ${(f.waiting/RATE).toFixed(0)} s waiting`);
 f.pending.push(...words.map(w=>({...w,start:streamTime(f,w.start),end:streamTime(f,w.end)})));
 for(;;){
  const cut=boundary(f.pending,false);if(cut<0)break;
  await line(live,f,f.pending.splice(0,cut+1));
 }
 partial(live,f);
}
function boundary(words:LocalWord[],final:boolean){
 for(let i=0;i<words.length;i++){
  const gap=i+1<words.length?words[i+1].start-words[i].end:0;
  if((/[.?!…]["”']?$/.test(words[i].word)&&i>=2)||gap>0.9||words[i].end-words[0].start>18)return i;
 }
 return final&&words.length?words.length-1:-1;
}
const wordsOf=(text:string)=>new Set(text.toLowerCase().match(/[\p{L}\p{N}']+/gu)??[]);
const overlap=(a:Set<string>,b:Set<string>)=>{if(!a.size||!b.size)return 0;let n=0;for(const w of a)if(b.has(w))n++;return n/Math.min(a.size,b.size);};
async function line(live:Live,f:Feed,words:LocalWord[]){
 if(!words.length)return;
 const text=words.map(w=>w.word).join(' ').replace(/\s+([,.;:!?…])/g,'$1').trim();if(!text)return;
 const raw={start:words[0].start,end:words.at(-1)!.end};
 const segment:Segment={start:round(mediaTime(f,raw.start)),end:round(mediaTime(f,raw.end)),speaker:f.speaker??await speakerOf(live,f,raw.start,raw.end),text};
 const said={feed:f,words:wordsOf(text),at:Date.now()};
 live.recent=live.recent.filter(r=>said.at-r.at<12_000);live.recent.push(said);
 if(f.speaker==='You'){
  // The microphone also hears the call through the speakers: its line waits a moment and is dropped if the call said it.
  const held={segment,timer:0};
  held.timer=setTimeout(()=>{f.held=f.held.filter(h=>h!==held);if(!live.recent.some(r=>r.feed!==f&&overlap(r.words,said.words)>=0.6))void commit(live,segment);},5000) as unknown as number;
  f.held.push(held);return;
 }
 await commit(live,segment);
}
const round=(n:number)=>Math.round(n*100)/100;
function fail(live:Live,error:unknown){
 const reason=String((error as Error)?.message??error).slice(0,300);note(`failed ${live.id.slice(0,8)}: ${reason}`);
 tell({type:'listen.failed',session:live.id,reason});
}
async function commit(live:Live,segment:Segment){
 if(!sessions.has(live.id)&&!live.ending)return;
 live.media.segments.push(segment);live.media.segments.sort((a,b)=>a.start-b.start);
 tell({type:'listen.caption',session:live.id,segment,title:live.media.title});
 if(Date.now()-live.lastSave>8000)await save(live);
}
/** Who said it: the voice's fingerprint matched against voices the user named, then against this session's voices. */
async function speakerOf(live:Live,f:Feed,start:number,end:number):Promise<string>{
 if(live.fake)return 'Speaker 1';
 if(end-start<1.2)return live.clusters.at(-1)?.name??'';
 const raw=await sound<number[]>('voice',audioAt(f,start,end));if(!raw)return live.clusters.at(-1)?.name??'';
 const v=unit(Float32Array.from(raw));
 let best:{name:string;score:number}|undefined;
 for(const voice of live.voices){const s=dot(v,unit(Float32Array.from(voice.print)));if(s>0.6&&(!best||s>best.score))best={name:voice.name,score:s};}
 if(best)return best.name;
 let cluster:Cluster|undefined,score=0;
 for(const c of live.clusters){const s=dot(v,unit(c.centroid));if(s>score){score=s;cluster=c;}}
 if(!cluster||score<0.55){cluster={centroid:v,count:0,name:`Speaker ${live.clusters.length+1}`};live.clusters.push(cluster);}
 const c=cluster;c.centroid=c.centroid.map((x,i)=>(x*c.count+v[i])/(c.count+1));c.count++;
 return c.name;
}
const dot=(a:Float32Array,b:Float32Array)=>{let s=0;for(let i=0;i<a.length;i++)s+=a[i]*b[i];return s;};
const unit=(v:Float32Array)=>{const n=Math.sqrt(dot(v,v))||1;return v.map(x=>x/n);};

async function save(live:Live){
 live.lastSave=Date.now();
 live.media.speakers=live.clusters.map(c=>({name:c.name,print:Array.from(c.centroid),count:c.count}));
 await add('media',live.media).catch(()=>{});await upsertMedia(live.media).catch(()=>{});
}
export function stopListening(session:string){
 const live=sessions.get(session);if(!live)return Promise.resolve({ok:false});
 return live.ending??=(async()=>{
  for(const f of live.feeds){
   f.audio?.close();
   // Ending settles the last window's words (they arrive through onWords); then what is left becomes the last lines.
   // What is still queued is heard first (the recording ended, but every word of it counts).
   while(f.pumping||f.backlog.length&&f.stream){if(!f.pumping)void pump(f);await new Promise(r=>setTimeout(r,100));}
   await f.stream?.end().catch(()=>{});await f.work;
   for(let cut=boundary(f.pending,true);cut>=0;cut=boundary(f.pending,true))await line(live,f,f.pending.splice(0,cut+1));
  }
  // The microphone's last lines: kept unless the call said them too.
  for(const f of live.feeds)for(const h of f.held.splice(0)){clearTimeout(h.timer);const w=wordsOf(h.segment.text);if(!live.recent.some(r=>r.feed!==f&&overlap(r.words,w)>=0.6))await commit(live,h.segment);}
  // Nothing was said (a sound effect, a video that could not be heard): nothing is kept.
  live.media.endedAt=Date.now();if(live.media.segments.length)await save(live);else await removeMedia(session).catch(()=>{});sessions.delete(session);
  tell({type:'listen.ended',session,seconds:live.media.segments.at(-1)?.end??0,lines:live.media.segments.length});
  return{ok:true};
 })();
}
/** Lines from a video's own captions (exact, so no Whisper): their times are the video's. */
export async function listenCues(m:{session:string;cues:{start:number;end:number;text:string}[]}){
 const live=sessions.get(m.session);if(!live)return{ok:false};live.lastAudio=Date.now();
 for(const c of m.cues){const text=c.text.replace(/<[^>]+>/g,'').replace(/\s+/g,' ').trim();if(text&&!live.media.segments.some(s=>Math.abs(s.start-c.start)<0.05&&s.text===text))await commit(live,{start:round(c.start),end:round(c.end),speaker:'',text});}
 return{ok:true};
}
/** Names a voice: its fingerprint is kept (sealed) so the next meeting knows it, and this session's lines are relabelled. */
export async function nameVoice(m:{session:string;speaker:string;name:string}){
 const live=sessions.get(m.session),cluster=live?.clusters.find(c=>c.name===m.speaker);
 if(!live||!cluster)return{ok:false};
 const voice:Voice={id:crypto.randomUUID(),name:m.name,print:Array.from(cluster.centroid),count:cluster.count};
 await add('voices',voice);live.voices.push(voice);
 for(const s of live.media.segments)if(s.speaker===m.speaker)s.speaker=m.name;
 cluster.name=m.name;await save(live);return{ok:true};
}
/** What is being heard now, for the side panel. */
export function listenState(){return{sessions:[...sessions.values()].map(l=>({session:l.id,title:l.media.title,kind:l.media.kind,url:l.media.url,startedAt:l.media.startedAt,segments:l.media.segments.slice(-400),speakers:l.clusters.map(c=>c.name)}))};}
// A page that went away without saying so (closed, crashed, navigated) stops being heard after a minute and a half.
setInterval(()=>{for(const l of sessions.values())if(l.source!=='tab'&&Date.now()-l.lastAudio>90_000)void stopListening(l.id);},15_000);

/** For tests: a stand-in for Whisper that says the given words, a few for every second of sound it hears. */
function fakeStream(script:string[],onWords:(w:LocalWord[])=>void):Stream{
 let at=0,next=0;
 return{
  async push(pcm){let energy=0;for(const s of pcm)energy+=s*s;const seconds=pcm.length/RATE;
   if(energy/pcm.length>1e-5){const batch:LocalWord[]=[];for(let k=0;k<6&&next<script.length;k++)batch.push({word:script[next++],start:at+k*0.15,end:at+k*0.15+0.12,probability:0.9,language:'english'});if(batch.length)onWords(batch);}
   at+=seconds;},
  async end(){},cancel(){},
 };
}
