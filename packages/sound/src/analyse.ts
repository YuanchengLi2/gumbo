import {fbank,subtractMean,frameCount,SAMPLE_RATE} from './fbank';
import {spectralRise,detrend,estimateTempo,trackBeats,ENVELOPE_RATE} from './beats';
import {clusterVoices,speakerTurns,WINDOW_SEC,type SpeakerWindow,type SpeakerTurn} from './speakers';
import {groupClasses,soundGroups,eventGroups,eventThreshold,type SoundGroup} from './classes';
import {audioSetClasses} from './audioset';

/** What a recording sounds like, measured on the user's computer in one pass over its sound (16 kHz mono):
 *  - YAMNet scores every 0.48 s for 521 kinds of sound: from these come the sections (speech, music, speech over music,
 *    singing, silence, other sound), the events (laughter, applause, a bang…) and where people speak;
 *  - the loudness every quarter second gives the moments much louder than their surroundings;
 *  - as each stretch of speech is found, the speaker model turns every 3 s of it into a voice embedding, and the voices
 *    are grouped into speakers at the end;
 *  - YAMNet's own spectrogram (100 frames a second) gives an onset envelope, from which music of 8 s or more gets its
 *    tempo and beats.
 * The same code runs for a ten-second clip and a six-hour recording, holding about a minute of samples at a time. */
export const SOUND_ANALYSIS_VERSION=1;
export type SoundModels={
 /** YAMNet: scores (frames × 521) for 16 kHz samples, and its log mel spectrogram (rows × 64, 100 rows a second). */
 classify(wave:Float32Array):Promise<{scores:Float32Array;frames:number;logMel:Float32Array;rows:number}>;
 /** The speaker model: a voice embedding for each of count windows of mean-normalised 80-band filterbank frames (count ×
  * frames × 80, all the same length). */
 embed(features:Float32Array,frames:number,count:number):Promise<Float32Array[]>;
};
export type SectionKind='speech'|'speech over music'|'music'|'singing'|'silence'|'other';
export type SoundSection={start:number;end:number;kind:SectionKind;label?:string};
export type SoundEvent={start:number;end:number;group:SoundGroup;label:string;score:number};
export type LoudMoment={at:number;db:number;rise:number};
export type MusicSection={start:number;end:number;bpm:number;beats:number[]};
export type SoundAnalysis={version:number;durationSec:number;levelDb?:number;sections:SoundSection[];events:SoundEvent[];omitted:Partial<Record<SoundGroup,number>>;loud:LoudMoment[];speakers:{count:number;share:Record<string,number>;turns:SpeakerTurn[]};music:MusicSection[]};

const CLASSES=521,MEL=64,PATCH=15360,STEP=7680,SLOT=.48,BLOCK_FRAMES=125,BLOCK=BLOCK_FRAMES*STEP,BLOCK_ROWS=BLOCK/160,QUARTER=SAMPLE_RATE/4;
const r2=(n:number)=>Math.round(n*100)/100;
// The "other sound" label of a stretch: the likeliest class that is not speech, music, singing, silence or the room.
const notOther=new Set([...groupClasses.speech,...groupClasses.singing,...groupClasses.silence,...Array.from({length:145},(_,i)=>132+i),500,501,502,503,504,505,506,520]);
/** Each frame stands for the middle 0.48 s of its 0.96 s window; the first starts at 0 and the last ends at the end. */
const slotStart=(f:number)=>f?f*SLOT+SLOT/2:0,slotEnd=(f:number,frames:number,duration:number)=>f>=frames-1?duration:f*SLOT+1.5*SLOT;

/** A growing buffer of samples that can drop what is no longer needed from its front. */
class Samples{
 data=new Float32Array(SAMPLE_RATE*8);length=0;base=0;
 push(chunk:Float32Array){if(this.length+chunk.length>this.data.length){const grown=new Float32Array(Math.max(this.data.length*2,this.length+chunk.length));grown.set(this.data.subarray(0,this.length));this.data=grown;}this.data.set(chunk,this.length);this.length+=chunk.length;}
 /** Samples [from, to) in recording positions. */
 view(from:number,to:number){return this.data.subarray(Math.max(0,from-this.base),Math.max(0,to-this.base));}
 get end(){return this.base+this.length;}
 drop(before:number){const n=Math.min(this.length,Math.max(0,before-this.base));if(!n)return;this.data.copyWithin(0,n,this.length);this.length-=n;this.base+=n;}
}

/** Stretches of speech (frames scoring as speech, joined across a half-second gap) followed as frames arrive, cut into the
 * speaker windows as soon as each is certain: whole 3 s windows from a stretch's start while it lasts, and when it ends,
 * a last window reaching back to fill 3 s (or one shorter window for a stretch of 1.5 to 3 s). */
class SpeechFollower{
 private open?:{from:number;last:number;next:number;region:number};private regions=0;
 constructor(private emit:(w:SpeakerWindow)=>void){}
 /** The frames [from, to) have their speech scores; final when they are the last. */
 frames(speech:number[],from:number,to:number,duration:number,final:boolean){
  // Only the very last frame of the recording ends at its end.
  const end=(f:number)=>final&&f>=to-1?duration:f*SLOT+1.5*SLOT;
  for(let f=from;f<to;f++){
   if(speech[f]<.5)continue;
   if(this.open&&f-this.open.last>2)this.close(end(this.open.last));
   if(!this.open)this.open={from:f,last:f,next:slotStart(f),region:this.regions++};else this.open.last=f;
  }
  const open=this.open;if(!open)return;
  if(final||to-1-open.last>2){this.close(end(open.last));return;}
  // While it lasts, the windows that already fit inside it.
  const reach=end(open.last);for(;open.next+WINDOW_SEC<=reach+1e-6;open.next+=WINDOW_SEC)this.emit({start:open.next,end:open.next+WINDOW_SEC,region:open.region});
 }
 private close(end:number){
  const open=this.open!;this.open=undefined;
  const start=slotStart(open.from),length=end-start;if(length<1.5)return;
  if(length<WINDOW_SEC){this.emit({start,end,region:open.region});return;}
  for(;open.next+WINDOW_SEC<=end+1e-6;open.next+=WINDOW_SEC)this.emit({start:open.next,end:open.next+WINDOW_SEC,region:open.region});
  if(open.next<end-.75)this.emit({start:end-WINDOW_SEC,end,region:open.region});
 }
 /** Where the samples still needed begin (a window still to come can reach back 3 s from the stretch's end). */
 neededFrom(){return this.open?Math.max(0,Math.min(this.open.next,slotStart(this.open.last)-WINDOW_SEC)):Infinity;}
}

function sections(scores:Record<SoundGroup,number[]>,other:number[],otherScore:number[],loudness:number[],duration:number):SoundSection[]{
 const frames=scores.speech.length;if(!frames)return[];
 const frameDb=(f:number)=>{const from=Math.floor(f*SLOT*4),to=Math.max(from+1,Math.floor((f*SLOT+2*SLOT)*4));let sum=0,n=0;for(let i=from;i<to&&i<loudness.length;i++){sum+=10**(loudness[i]/10);n++;}return n?10*Math.log10(sum/n+1e-10):-100;};
 const raw:SectionKind[]=Array.from({length:frames},(_,f)=>frameDb(f)<-50||scores.silence[f]>.6?'silence':scores.speech[f]>=.5?scores.music[f]>=.3?'speech over music':'speech':scores.singing[f]>=.4?'singing':scores.music[f]>=.4?'music':'other');
 // A frame takes the most common kind around it (a second either way), so a breath does not split a sentence.
 const kinds=raw.map((_,f)=>{const tally=new Map<SectionKind,number>();for(let k=Math.max(0,f-2);k<=Math.min(frames-1,f+2);k++)tally.set(raw[k],(tally.get(raw[k])??0)+1);return[...tally].sort((a,b)=>b[1]-a[1]||(a[0]===raw[f]?-1:1))[0][0];});
 const runs:{from:number;to:number;kind:SectionKind}[]=[];for(let f=0;f<frames;f++){const last=runs[runs.length-1];if(last&&last.kind===kinds[f])last.to=f;else runs.push({from:f,to:f,kind:kinds[f]});}
 // Under two seconds is not a section: it joins the one before (or after, at the start).
 for(let i=0;i<runs.length;i++){const r=runs[i];if(runs.length>1&&(r.to-r.from+1)*SLOT<2){const into=i?runs[i-1]:runs[i+1];into.from=Math.min(into.from,r.from);into.to=Math.max(into.to,r.to);runs.splice(i,1);i=Math.max(-1,i-2);}}
 const merged:typeof runs=[];for(const r of runs){const last=merged[merged.length-1];if(last&&last.kind===r.kind)last.to=r.to;else merged.push({...r});}
 return merged.map(r=>{
  let label:string|undefined;
  if(r.kind==='other'){const tally=new Map<number,number>();for(let f=r.from;f<=r.to;f++)if(other[f]>=0)tally.set(other[f],(tally.get(other[f])??0)+otherScore[f]);const top=[...tally].sort((a,b)=>b[1]-a[1])[0];if(top)label=audioSetClasses[top[0]];}
  return{start:r2(slotStart(r.from)),end:r2(slotEnd(r.to,frames,duration)),kind:r.kind,...(label?{label}:{})};
 });
}

/** Events: stretches where a group scores over its threshold, joined across gaps of a second; the strongest 40 of each kind
 * are kept (the rest are counted), so constant gunfire in a game does not bury a laugh. */
function events(scores:Record<SoundGroup,number[]>,best:Record<SoundGroup,number[]>,duration:number){
 const frames=scores.speech.length,out:SoundEvent[]=[],omitted:Partial<Record<SoundGroup,number>>={};
 for(const g of eventGroups){
  const threshold=eventThreshold[g]!,score=scores[g],found:SoundEvent[]=[],tally=new Map<number,number>();let from=-1,last=-1,peak=0;
  const close=()=>{if(from<0)return;const top=[...tally].sort((a,b)=>b[1]-a[1])[0];found.push({start:r2(slotStart(from)),end:r2(slotEnd(last,frames,duration)),group:g,label:audioSetClasses[top[0]],score:r2(peak)});from=-1;peak=0;tally.clear();};
  for(let f=0;f<frames;f++){
   if(score[f]<threshold)continue;
   if(from>=0&&f-last>2)close();
   if(from<0)from=f;last=f;peak=Math.max(peak,score[f]);tally.set(best[g][f],(tally.get(best[g][f])??0)+score[f]);
  }
  close();
  const kept=found.length>40?[...found].sort((a,b)=>b.score-a.score).slice(0,40):found;if(found.length>kept.length)omitted[g]=found.length-kept.length;
  out.push(...kept);
 }
 return{events:out.sort((a,b)=>a.start-b.start),omitted};
}

/** Moments at least 9 dB louder than the 30 seconds around them (and not near-silent), at least 5 s apart: a shout, a
 * crash, a crowd going up. About one a minute, never more than 60. */
function loudMoments(loudness:number[],duration:number):LoudMoment[]{
 const n=loudness.length;if(n<8)return[];
 const power=loudness.map(db=>10**(db/10)),second=loudness.map((_,i)=>{let s=0,c=0;for(let k=i;k<Math.min(n,i+4);k++){s+=power[k];c++;}return 10*Math.log10(s/c+1e-10);});
 // The baseline (the median of the 30 s around) is taken once a second; it moves slowly.
 const candidates:LoudMoment[]=[];let baseline=0;
 for(let i=0;i<n;i++){
  if(i%4===0){const around=second.slice(Math.max(0,i-60),Math.min(n,i+60)).sort((a,b)=>a-b);baseline=around[Math.floor(around.length/2)];}
  if(second[i]<-40)continue;
  const rise=second[i]-baseline;
  if(rise>=9)candidates.push({at:r2(i/4+.5),db:Math.round(second[i]),rise:Math.round(rise)});
 }
 candidates.sort((a,b)=>b.rise-a.rise||b.db-a.db);
 const kept:LoudMoment[]=[],limit=Math.min(60,Math.max(8,Math.round(duration/60)));
 for(const c of candidates){if(kept.length>=limit)break;if(kept.every(k=>Math.abs(k.at-c.at)>=5))kept.push(c);}
 return kept.sort((a,b)=>a.at-b.at);
}

/** Measures a recording's sound. read gives its samples (16 kHz mono, in [-1, 1]); durationSec is the source's length
 * (the sound may stop short of it). */
export async function analyseSound(read:AsyncIterable<Float32Array>,durationSec:number,models:SoundModels,signal:AbortSignal):Promise<SoundAnalysis>{
 const scores=Object.fromEntries(soundGroups.map(g=>[g,[] as number[]])) as Record<SoundGroup,number[]>,best=Object.fromEntries(soundGroups.map(g=>[g,[] as number[]])) as Record<SoundGroup,number[]>;
 const other:number[]=[],otherScore:number[]=[],loudness:number[]=[],rises:Float32Array[]=[],buffer=new Samples();
 let squares=0,count=0,total=0,blockStart=0,lastMel:Float32Array|undefined;
 // Voices: windows are embedded as soon as they are certain, full 3 s windows 32 at a time (a GPU does a batch in about the time of one).
 const windows:SpeakerWindow[]=[],embeddings:Float32Array[]=[],fullFrames=frameCount(WINDOW_SEC*SAMPLE_RATE);let batch:{i:number;data:Float32Array}[]=[];
 const flush=async()=>{if(!batch.length)return;const items=batch;batch=[];const joined=new Float32Array(items.length*fullFrames*80);items.forEach((b,k)=>joined.set(b.data,k*fullFrames*80));(await models.embed(joined,fullFrames,items.length)).forEach((e,k)=>{embeddings[items[k].i]=e;});};
 const pending:SpeakerWindow[]=[],follower=new SpeechFollower(w=>pending.push(w));
 const embedPending=async()=>{
  for(const w of pending.splice(0)){
   const samples=buffer.view(Math.round(w.start*SAMPLE_RATE),Math.round(w.end*SAMPLE_RATE)),{frames,data}=fbank(samples,80);if(frames<10)continue;
   subtractMean(data,frames,80);const i=windows.push(w)-1;
   if(frames!==fullFrames){[embeddings[i]]=await models.embed(data,frames,1);continue;}
   batch.push({i,data});if(batch.length>=32)await flush();
  }
 };
 const classify=async(length:number,frames:number,rows:number,final:boolean)=>{
  const out=await models.classify(buffer.view(blockStart,blockStart+length)),n=Math.min(frames,out.frames),first=scores.speech.length;
  for(let f=0;f<n;f++){
   const row=out.scores.subarray(f*CLASSES,(f+1)*CLASSES);
   for(const g of soundGroups){let top=0,arg=groupClasses[g][0];for(const k of groupClasses[g])if(row[k]>top){top=row[k];arg=k;}scores[g].push(top);best[g].push(arg);}
   let top=0,arg=-1;for(let k=0;k<CLASSES;k++)if(!notOther.has(k)&&row[k]>top){top=row[k];arg=k;}other.push(arg);otherScore.push(top);
  }
  const used=Math.min(rows,out.rows),mel=out.logMel.subarray(0,used*MEL);rises.push(spectralRise(mel,used,MEL,lastMel));if(used)lastMel=mel.slice((used-1)*MEL,used*MEL);
  follower.frames(scores.speech,first,first+n,Math.max(durationSec,total/SAMPLE_RATE),final);await embedPending();
 };
 for await(const chunk of read){
  signal.throwIfAborted();
  for(let i=0;i<chunk.length;i++){const v=chunk[i];squares+=v*v;if(++count>=QUARTER){loudness.push(10*Math.log10(squares/count+1e-10));squares=0;count=0;}}
  buffer.push(chunk);total+=chunk.length;
  while(buffer.end-blockStart>=BLOCK+STEP){await classify(BLOCK+STEP,BLOCK_FRAMES,BLOCK_ROWS,false);blockStart+=BLOCK;buffer.drop(Math.min(blockStart,follower.neededFrom()*SAMPLE_RATE));}
 }
 if(count)loudness.push(10*Math.log10(squares/count+1e-10));
 const duration=Math.max(durationSec,total/SAMPLE_RATE),rest=buffer.end-blockStart;
 // The rest: every frame that starts inside it (a clip under a second still gets one).
 if(rest>=STEP||!other.length&&rest>0)await classify(rest,1+Math.ceil(Math.max(0,rest-PATCH)/STEP),Math.floor(rest/160),true);
 else{follower.frames(scores.speech,scores.speech.length,scores.speech.length,duration,true);await embedPending();}
 await flush();

 const found=events(scores,best,duration),audible=loudness.filter(db=>db>-50),levelDb=audible.length?Math.round(10*Math.log10(audible.reduce((s,db)=>s+10**(db/10),0)/audible.length)):undefined;
 const list=sections(scores,other,otherScore,loudness,duration);
 const kept=windows.map((w,i)=>({w,e:embeddings[i]})).filter(x=>x.e);
 const speakers=kept.length?speakerTurns(kept.map(x=>x.w),clusterVoices(kept.map(x=>x.e))):{count:0,share:{},turns:[]};
 // Tempo and beats over each stretch of music of 8 s or more (speech over music and singing count).
 const envelope=new Float32Array(rises.reduce((n,r)=>n+r.length,0));let at=0;for(const r of rises){envelope.set(r,at);at+=r.length;}
 const music:MusicSection[]=[];
 for(const s of list.filter(s=>s.kind==='music'||s.kind==='singing'||s.kind==='speech over music').reduce((all,s)=>{const last=all[all.length-1];if(last&&s.start-last.end<1)last.end=s.end;else all.push({start:s.start,end:s.end});return all;},[] as {start:number;end:number}[]).filter(s=>s.end-s.start>=8)){
  const onset=detrend(envelope.subarray(Math.round(s.start*ENVELOPE_RATE),Math.round(s.end*ENVELOPE_RATE))),bpm=estimateTempo(onset);if(!bpm)continue;
  music.push({start:s.start,end:s.end,bpm:Math.round(bpm*10)/10,beats:trackBeats(onset,bpm).map(t=>r2(s.start+t))});
 }
 return{version:SOUND_ANALYSIS_VERSION,durationSec:r2(duration),...(levelDb!==undefined?{levelDb}:{}),sections:list,events:found.events,omitted:found.omitted,loud:loudMoments(loudness,duration),speakers,music};
}
