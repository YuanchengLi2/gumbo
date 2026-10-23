import {describe,it,expect} from 'vitest';
import {LoudnessMeter} from '../../apps/web/src/project/media/loudness';
import {stretch} from '../../apps/web/src/export/stretch';

/** The web export's sound (apps/web/src/export): loudness measured as BS.1770 defines it, and clips sped up or slowed
 * down with their pitch kept, as ffmpeg's ebur128 and atempo do on the desktop. */
const RATE=48000;
const sine=(hz:number,amplitude:number,seconds:number)=>Float32Array.from({length:Math.round(seconds*RATE)},(_,i)=>amplitude*Math.sin(2*Math.PI*hz*i/RATE));
/** The tone's frequency from its rising zero crossings. */
function frequency(signal:Float32Array){let crossings=0;for(let i=1;i<signal.length;i++)if(signal[i-1]<0&&signal[i]>=0)crossings++;return crossings/(signal.length/RATE);}

describe('web export sound',()=>{
 it('measures a 1 kHz tone at -20 dBFS in both channels as -20 LUFS, its peak as -20 dBTP',()=>{
  const meter=new LoudnessMeter(2),tone=sine(1000,.1,5);
  for(let i=0;i<tone.length;i+=4800)meter.add([tone.subarray(i,i+4800),tone.subarray(i,i+4800)]);
  expect(meter.integrated()).toBeCloseTo(-20,0);
  expect(meter.truePeakDb()).toBeCloseTo(-20,0);
 });
 it('gates silence out of the integrated loudness',()=>{
  const meter=new LoudnessMeter(2),tone=sine(1000,.1,3),quiet=new Float32Array(RATE*3);
  meter.add([tone,tone]);meter.add([quiet,quiet]);
  expect(meter.integrated()).toBeCloseTo(-20,0);
  expect(new LoudnessMeter(2).integrated()).toBe(-70);
 });
 for(const speed of [2,.5,1.5]){
  it(`keeps the pitch at ${speed}x, at the length asked for`,()=>{
   const source=sine(440,.5,3),length=Math.round(source.length/speed)-RATE/10,[left,right]=stretch([source,source],speed,length);
   expect(left.length).toBe(length);expect(right.length).toBe(length);
   expect(frequency(left.subarray(RATE/10,length-RATE/10))).toBeCloseTo(440,-1);
   // Steady level: no dropouts where frames overlap.
   const rms=(a:Float32Array)=>Math.sqrt(a.reduce((s,v)=>s+v*v,0)/a.length);
   for(let at=RATE/10;at+RATE/10<length-RATE/10;at+=RATE/10)expect(rms(left.subarray(at,at+RATE/10))).toBeGreaterThan(.3);
  });
 }
});
