import {describe,it,expect} from 'vitest';
import {existsSync,readFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {resolve,join} from 'node:path';
import {estimateTempo,trackBeats,onsetEnvelope} from '../../packages/sound/src/beats';
import {fbank,subtractMean,frameCount} from '../../packages/sound/src/fbank';
import {clusterVoices,speakerTurns,speakerWindows,normalise} from '../../packages/sound/src/speakers';
import {groupClasses} from '../../packages/sound/src/classes';
import {analyseSound,loadSoundModels,soundModelFiles,type OnnxRuntime} from '@dream/sound';

const RATE=16000;
/** A click track: a short burst of noise on every beat, quiet in between. */
function clicks(bpm:number,seconds:number){
 const out=new Float32Array(seconds*RATE),period=60/bpm*RATE;let seed=1;const noise=()=>((seed=seed*1103515245+12345>>>0)/2**32)*2-1;
 for(let at=RATE*.25;at<out.length;at+=period)for(let i=0;i<400&&at+i<out.length;i++)out[Math.floor(at)+i]=noise()*Math.exp(-i/80);
 for(let i=0;i<out.length;i++)out[i]+=noise()*.002;
 return out;
}

describe('sound analysis',()=>{
 it('finds the tempo and the beats of music',()=>{
  const wave=clicks(120,20),mel=fbank(wave,40),envelope=onsetEnvelope(mel.data,mel.frames,40),bpm=estimateTempo(envelope)!;
  expect(bpm).toBeGreaterThan(118);expect(bpm).toBeLessThan(122);
  const beats=trackBeats(envelope,bpm);
  expect(beats.length).toBeGreaterThan(35);
  // Every beat lands on a click (0.25 s, then every half second), within two frames.
  for(const t of beats)expect(Math.abs(((t-.25)%.5+.5)%.5-.0)%.5<.03||Math.abs(((t-.25)%.5+.5)%.5-.5)<.03).toBe(true);
 });
 it('computes the filterbank the speaker model expects: 25 ms frames every 10 ms, 80 bands',()=>{
  const {frames,data}=fbank(clicks(90,3),80);
  expect(frames).toBe(frameCount(3*RATE));expect(frames).toBe(298);expect(data.length).toBe(298*80);
  subtractMean(data,frames,80);let mean=0;for(let f=0;f<frames;f++)mean+=data[f*80+10];expect(Math.abs(mean/frames)).toBeLessThan(1e-4);
 });
 it('groups voices: one voice stays one, two voices part, and a stray window is not a person',()=>{
  const voice=(seed:number)=>Float32Array.from({length:64},(_,i)=>Math.sin(seed*(i+1)*1.7)),near=(v:Float32Array,k:number)=>normalise(v.map((x,i)=>x+.25*Math.sin(k*13.1+i*.7)));
  const a=voice(1),b=voice(2),stray=voice(3);
  expect(new Set(clusterVoices(Array.from({length:30},(_,k)=>near(a,k)))).size).toBe(1);
  const labels=clusterVoices([...Array.from({length:12},(_,k)=>near(a,k)),...Array.from({length:12},(_,k)=>near(b,k+50)),near(stray,99)]);
  expect(new Set(labels.slice(0,12)).size).toBe(1);expect(new Set(labels.slice(12,24)).size).toBe(1);expect(labels[0]).not.toBe(labels[12]);
  expect(new Set(labels).size).toBe(2);
 });
 it('turns windows into speaker turns lettered in the order the voices are heard',()=>{
  const windows=speakerWindows([{start:0,end:9},{start:10,end:16}]);
  expect(windows.map(w=>[w.start,w.end])).toEqual([[0,3],[3,6],[6,9],[10,13],[13,16]]);
  const {turns,count,share}=speakerTurns(windows,[5,5,2,2,5]);
  // One voice's windows join; across a pause of a second or more its turns stay apart.
  expect(count).toBe(2);expect(turns).toEqual([{start:0,end:6,speaker:'A'},{start:6,end:9,speaker:'B'},{start:10,end:13,speaker:'B'},{start:13,end:16,speaker:'A'}]);
  expect(share.A+share.B).toBeCloseTo(1,1);
 });
 it('names only classes YAMNet has',()=>{expect(groupClasses.laughter.length).toBeGreaterThan(2);expect(groupClasses.speech).toContain(0);});
});

// With the models on this computer (scripts' artifacts/models, as the eval and the desktop download them): the real
// analysis on real recordings.
const models=resolve('artifacts/models'),samples=resolve('artifacts/models-download'),ffmpeg=resolve('apps/desktop/resources/staged/media-runtime/ffmpeg.exe');
const available=soundModelFiles.every(f=>existsSync(join(models,f.filename)))&&existsSync(ffmpeg);
async function* decode(file:string){
 const child=spawn(ffmpeg,['-v','error','-i',file,'-vn','-ac','1','-ar','16000','-f','f32le','pipe:1']);let rest:Buffer=Buffer.alloc(0);
 for await(const chunk of child.stdout as AsyncIterable<Buffer>){const b=rest.length?Buffer.concat([rest,chunk]):chunk,n=b.length-b.length%4,out=new Float32Array(n/4);new Uint8Array(out.buffer).set(b.subarray(0,n));rest=b.subarray(n);yield out;}
}
describe.skipIf(!available)('sound analysis with the models',()=>{
 const load=async()=>{const module:any=await import('onnxruntime-node');return loadSoundModels((module.InferenceSession?module:module.default) as OnnxRuntime,async f=>new Uint8Array(readFileSync(join(models,f.filename))),{intraOpNumThreads:2});};
 it.skipIf(!existsSync(join(samples,'2-two-speakers-en.wav')))('hears two people talking as two voices, and the applause after',async()=>{
  const m=await load();try{
   const result=await analyseSound(decode(join(samples,'2-two-speakers-en.wav')),0,m,new AbortController().signal);
   expect(result.speakers.count).toBe(2);expect(Math.min(...Object.values(result.speakers.share))).toBeGreaterThan(.3);
   expect(result.events.some(e=>e.group==='applause'&&e.start>25)).toBe(true);
   expect(result.sections[0].kind).toBe('speech');
  }finally{await m.release();}
 },60000);
 it.skipIf(!existsSync('artifacts/footage-cache/talk-excerpt-3min.mp4'))('hears a lecture as one voice speaking throughout',async()=>{
  const m=await load();try{
   const result=await analyseSound(decode(resolve('artifacts/footage-cache/talk-excerpt-3min.mp4')),180,m,new AbortController().signal);
   expect(result.speakers.count).toBe(1);expect(result.sections.map(s=>s.kind)).toEqual(['speech']);expect(result.music).toEqual([]);
  }finally{await m.release();}
 },120000);
});
