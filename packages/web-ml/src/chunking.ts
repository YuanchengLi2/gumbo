import {SAMPLE_RATE} from './types';

/** Where two windows meet: the overlap [from,to) in seconds and the moment inside it where ownership passes (the quietest
 * point, so the words either side of it are whole in both windows). */
export type Seam={from:number;to:number;cut:number};
export type AudioWindow={index:number;start:number;samples:Float32Array;seam?:Seam};

/** Cuts a stream of PCM pushed in any sizes into Whisper's 30-second windows that overlap by a few seconds. Holds only
 * the samples not yet handed out (at most one window plus what was pushed since), so hours of audio stay a few MB. */
export class Windower {
 private buffer=new Float32Array(0);private length=0;private bufferStart=0;private nextStart=0;private index=0;private ended=false;private total=0;
 private readonly window:number;private readonly step:number;
 constructor(windowSec=30,private overlapSec=4){
  if(!(overlapSec>=0&&overlapSec<windowSec/2))throw new Error('Overlap must be under half a window.');
  this.window=Math.round(windowSec*SAMPLE_RATE);this.step=this.window-Math.round(overlapSec*SAMPLE_RATE);
 }
 /** Samples held, for back-pressure. */
 get buffered(){return this.length;}
 /** Samples and seconds pushed so far. */
 get received(){return this.total;}
 get seconds(){return this.total/SAMPLE_RATE;}
 push(pcm:Float32Array){
  if(this.ended)throw new Error('Audio was already ended.');
  if(this.length+pcm.length>this.buffer.length){const grown=new Float32Array(Math.max(this.length+pcm.length,this.buffer.length*2,this.window));grown.set(this.buffer.subarray(0,this.length));this.buffer=grown;}
  this.buffer.set(pcm,this.length);this.length+=pcm.length;this.total+=pcm.length;
 }
 end(){this.ended=true;}
 /** The next window once its samples are all here (or the audio has ended), else undefined. */
 next():AudioWindow|undefined{
  const start=this.nextStart,end=Math.min(start+this.window,this.ended?this.total:Infinity);
  if(!this.ended&&this.total<start+this.window)return undefined;
  // After the first window, audio that the previous window already heard in full needs no window of its own.
  if(this.index>0?end<=start+this.window-this.step:end<=start)return undefined;
  const samples=this.buffer.slice(start-this.bufferStart,end-this.bufferStart),index=this.index++;
  let seam:Seam|undefined;
  if(index>0){const overlap=Math.min(this.window-this.step,samples.length),margin=Math.min(SAMPLE_RATE,overlap/4),cut=quietestPoint(samples,margin,overlap-margin);seam={from:start/SAMPLE_RATE,to:(start+overlap)/SAMPLE_RATE,cut:(start+cut)/SAMPLE_RATE};}
  this.nextStart=start+this.step;
  const drop=Math.min(this.length,this.nextStart-this.bufferStart);this.buffer.copyWithin(0,drop,this.length);this.length-=drop;this.bufferStart+=drop;
  return{index,start:start/SAMPLE_RATE,samples,seam};
 }
}

/** The sample in [from,to) in the middle of the quietest stretch: 100 ms windows over 10 ms hops, and when several
 * windows in a row are as quiet (a pause longer than 100 ms), the middle of the pause. */
export function quietestPoint(samples:Float32Array,from:number,to:number):number{
 const hop=160,span=10,first=Math.max(0,Math.floor(from/hop)),last=Math.floor(Math.min(to,samples.length)/hop);
 if(last-first<=span)return Math.round((from+to)/2);
 const energy=new Float64Array(last-first);for(let h=first;h<last;h++){let sum=0;for(let i=h*hop,e=i+hop;i<e;i++)sum+=samples[i]*samples[i];energy[h-first]=sum;}
 const sums=new Float64Array(energy.length-span+1);let window=0;for(let h=0;h<energy.length;h++){window+=energy[h];if(h>=span)window-=energy[h-span];if(h>=span-1)sums[h-span+1]=window;}
 let at=0;for(let k=1;k<sums.length;k++)if(sums[k]<sums[at])at=k;
 let until=at;while(until+1<sums.length&&sums[until+1]<=sums[at]*1.05+1e-9)until++;
 return Math.round((first+(at+until+span)/2)*hop);
}

/** The share of 20 ms frames well above the window's own quiet floor (speech-timing.ts's rule for PCM16 WAV, on float
 * PCM). A window with almost none is not decoded: Whisper invents words ("Thank you.") for silence. */
export function speechFraction(samples:Float32Array):number{
 const frame=320,count=Math.floor(samples.length/frame);if(!count)return 0;
 const levels=new Float64Array(count);for(let f=0;f<count;f++){let sum=0;for(let i=f*frame,e=i+frame;i<e;i++)sum+=samples[i]*samples[i];levels[f]=10*Math.log10(sum/frame+1e-10);}
 const floor=[...levels].sort((a,b)=>a-b)[Math.floor(count*.2)],threshold=Math.max(floor+10,-50);
 let active=0;for(const level of levels)if(level>threshold)active++;return active/count;
}

export const pcm16ToFloat32=(pcm:Int16Array)=>Float32Array.from(pcm,v=>v/32768);
/** The PCM of a 16 kHz mono PCM16 WAV (the chunks the project service already cuts for the gateway). */
export function wavToPcm(wav:Uint8Array):Float32Array{
 const view=new DataView(wav.buffer,wav.byteOffset,wav.byteLength),tag=(at:number)=>String.fromCharCode(wav[at],wav[at+1],wav[at+2],wav[at+3]);
 if(wav.length<44||tag(0)!=='RIFF'||tag(8)!=='WAVE')throw new Error('Not a WAV file.');
 for(let at=12;at+8<=wav.length;){const length=view.getUint32(at+4,true);
  if(tag(at)==='fmt '&&(view.getUint16(at+8,true)!==1||view.getUint16(at+10,true)!==1||view.getUint32(at+12,true)!==SAMPLE_RATE||view.getUint16(at+22,true)!==16))throw new Error('Audio must be 16 kHz mono PCM16.');
  if(tag(at)==='data'){const size=Math.min(length,wav.length-at-8)>>1,out=new Float32Array(size);for(let i=0;i<size;i++)out[i]=view.getInt16(at+8+i*2,true)/32768;return out;}
  at+=8+length+(length%2);
 }
 throw new Error('WAV has no audio data.');
}
