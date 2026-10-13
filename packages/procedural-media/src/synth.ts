import {ScoreSchema,type ScoreDocument,type ScoreTrack,type Instrument} from './schema';
import {encodeWav,waveform,AUDIO_RATE} from './wav';

function random(seed:number){let value=seed>>>0;return()=>{value=(Math.imul(value,1664525)+1013904223)>>>0;return value/4294967296*2-1;};}
function salt(text:string){let n=2166136261;for(const c of text)n=Math.imul(n^c.charCodeAt(0),16777619);return n;}
function lane(track:ScoreTrack,target:'gainDb'|'pan'|'brightness',fallback:number){const points=track.automation.find(a=>a.target===target)?.points;let cursor=0;return(beat:number)=>{if(!points)return fallback;while(cursor+1<points.length&&beat>=points[cursor+1].beat)cursor++;const a=points[cursor],b=points[cursor+1];if(!b||beat<=a.beat)return a.value;return a.value+(b.value-a.value)*(beat-a.beat)/(b.beat-a.beat);};}
function voice(instrument:Instrument,t:number,length:number,hz:number,noise:number){
 const phase=2*Math.PI*hz*t,attack=Math.min(1,t/.006),release=Math.min(1,Math.max(0,length-t)/.03);
 if(instrument==='kick'||instrument==='impact')return Math.sin(2*Math.PI*(48*t+5*(1-Math.exp(-t*45))))*Math.exp(-t*(instrument==='kick'?18:7))*.7;
 if(instrument==='snare')return (noise*.65+Math.sin(2*Math.PI*185*t)*.2)*Math.exp(-t*28)*attack;
 if(instrument==='hat'||instrument==='shaker'||instrument==='cymbal')return noise*Math.exp(-t*(instrument==='cymbal'?5:65))*.2*attack;
 if(instrument==='tom')return Math.sin(2*Math.PI*(100*t+2*(1-Math.exp(-t*30))))*Math.exp(-t*15)*.5;
 if(instrument==='riser'){const p=t/length;return (noise*.14+Math.sin(phase*(1+p*2))*.08)*Math.sin(Math.PI*p/2)*release;}
 if(instrument==='pad')return (Math.sin(phase)+.15*Math.sin(phase*1.003)+.08*Math.sin(phase*2))*.08*Math.min(1,t/.18)*Math.min(1,(length-t)/.35);
 if(instrument==='bass')return (Math.sin(phase)+.15*Math.sin(phase*2))*.26*attack*Math.exp(-t/.4)*release;
 if(instrument==='keys')return (Math.sin(phase)+.28*Math.sin(phase*2)+.08*Math.sin(phase*4))*.12*attack*Math.exp(-t/.6)*release;
 if(instrument==='lead')return (Math.sin(phase)+.1*Math.sin(phase*3))*.13*attack*release;
 return (Math.sin(phase)+.2*Math.sin(phase*2)+.07*Math.sin(phase*3))*.18*attack*Math.exp(-t/.24)*release;
}
/** Scores are mastered to the loudness of a released track (about -11 dBFS RMS), whatever their track gains, because the
 * timeline's music gain and speech ducking assume one; peaks above the knee are softly limited below -1 dBFS. */
export const MASTER_RMS=10**(-11/20);
export function softLimit(value:number,knee=.7,ceiling=.89){const size=Math.abs(value);return size<=knee?value:Math.sign(value)*(knee+(ceiling-knee)*Math.tanh((size-knee)/(ceiling-knee)));}
function master(mix:Float32Array){
 let sum=0;for(const sample of mix)sum+=sample*sample;const rms=Math.sqrt(sum/Math.max(1,mix.length));if(rms<1e-6)return 1;
 const gain=MASTER_RMS/rms;for(let i=0;i<mix.length;i++)mix[i]=softLimit(mix[i]*gain);
 return gain;
}
export function renderArrangement(input:ScoreDocument,onStem?:(track:ScoreTrack,wav:Uint8Array,peaks:number[])=>void,onProgress?:(progress:number)=>void){
 const score=ScoreSchema.parse(input),frames=Math.ceil(score.durationSec*AUDIO_RATE),mix=new Float32Array(frames*2),beatSec=60/score.tempo;
 for(let n=0;n<score.tracks.length;n++){
  const track=score.tracks[n],mono=new Float32Array(frames);
  if(!track.mute)for(const note of track.notes){
   const from=Math.round(note.beat*beatSec*AUDIO_RATE),length=note.durationBeats*beatSec,count=Math.max(0,Math.min(Math.ceil(length*AUDIO_RATE),frames-from)),rng=random(score.seed^salt(track.id+':'+note.id));
   const hz=440*2**((note.pitch-69)/12);for(let i=0;i<count;i++)mono[from+i]+=voice(track.instrument,i/AUDIO_RATE,length,hz,rng())*note.velocity;
  }
  const stem=new Float32Array(frames*2),gain=lane(track,'gainDb',track.gainDb),pan=lane(track,'pan',track.pan),brightness=lane(track,'brightness',1);let filtered=0;
  for(let i=0;i<frames;i++){
   const time=i/AUDIO_RATE,beat=time/beatSec,level=Math.pow(10,gain(beat)/20),position=(pan(beat)+1)*Math.PI/4,coefficient=.02+brightness(beat)*.98;
   filtered+=coefficient*(mono[i]-filtered);const fade=Math.max(0,Math.min(1,time/.03,(score.durationSec-time)/Math.min(.4,score.durationSec/4)));
   const value=Math.tanh(filtered*level)*fade;
   stem[i*2]=value*Math.cos(position);stem[i*2+1]=value*Math.sin(position);mix[i*2]+=stem[i*2];mix[i*2+1]+=stem[i*2+1];
  }
  onStem?.(track,encodeWav(stem),waveform(stem));onProgress?.((n+1)/(score.tracks.length+1));
 }
 const masterGain=master(mix);
 const result={wav:encodeWav(mix),waveform:waveform(mix),beats:Array.from({length:Math.ceil(score.durationSec/beatSec)},(_,i)=>i*beatSec),masterGain,sampleRate:AUDIO_RATE,channels:2 as const};onProgress?.(1);return result;
}
