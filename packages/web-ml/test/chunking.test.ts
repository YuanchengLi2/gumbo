import {it,expect} from 'vitest';
import {Windower,quietestPoint,speechFraction,wavToPcm,SAMPLE_RATE} from '../src';

const SR=SAMPLE_RATE;
/** A ramp, so every sample says where it came from. */
const ramp=(seconds:number)=>Float32Array.from({length:Math.round(seconds*SR)},(_,i)=>i/1e7);
function drain(windower:Windower){const out=[];for(let w=windower.next();w;w=windower.next())out.push(w);return out;}

it('cuts a stream pushed in odd sizes into 30 s windows that overlap by 4 s, holding at most a window',()=>{
 const source=ramp(70),windower=new Windower(30,4),windows=[];let most=0;
 for(let at=0,n=1;at<source.length;at+=n,n=(n*7919)%(SR*3)+1){windower.push(source.subarray(at,at+n));most=Math.max(most,windower.buffered);windows.push(...drain(windower));}
 windower.end();windows.push(...drain(windower));
 expect(windows.map(w=>[w.start,w.samples.length/SR])).toEqual([[0,30],[26,30],[52,18]]);
 for(const w of windows){let wrong=0;for(let i=0;i<w.samples.length;i++)if(w.samples[i]!==source[w.start*SR+i])wrong++;expect(wrong).toBe(0);}
 expect(windows[0].seam).toBeUndefined();
 for(const w of windows.slice(1)){expect(w.seam!.from).toBe(w.start);expect(w.seam!.to).toBe(w.start+4);expect(w.seam!.cut).toBeGreaterThanOrEqual(w.start+1);expect(w.seam!.cut).toBeLessThanOrEqual(w.start+3);}
 // Bounded memory: never more than one window plus the largest push.
 expect(most).toBeLessThanOrEqual(30*SR+3*SR);
});

it('needs no extra window when the previous one already heard the end, and none for empty audio',()=>{
 const exact=new Windower();exact.push(ramp(30));exact.end();expect(drain(exact).map(w=>w.samples.length/SR)).toEqual([30]);
 const covered=new Windower();covered.push(ramp(56));covered.end();expect(drain(covered).map(w=>[w.start,w.samples.length/SR])).toEqual([[0,30],[26,30]]);
 const tail=new Windower();tail.push(ramp(56.5));tail.end();expect(drain(tail).map(w=>[w.start,w.samples.length/SR])).toEqual([[0,30],[26,30],[52,4.5]]);
 const short=new Windower();short.push(ramp(9.5));expect(drain(short)).toEqual([]);short.end();expect(drain(short).map(w=>w.samples.length/SR)).toEqual([9.5]);
 const empty=new Windower();empty.end();expect(drain(empty)).toEqual([]);
 expect(()=>empty.push(ramp(1))).toThrow(/ended/);
});

it('hands ownership over at the quietest moment of the overlap',()=>{
 const loud=Float32Array.from({length:4*SR},(_,i)=>Math.sin(i/3)*.5);loud.fill(0,Math.round(2.6*SR),Math.round(2.8*SR));
 expect(quietestPoint(loud,SR,3*SR)/SR).toBeCloseTo(2.7,1);
 // Outside the search range the gap does not count.
 const late=Float32Array.from({length:4*SR},(_,i)=>Math.sin(i/3)*.5);late.fill(0,Math.round(3.4*SR),Math.round(3.6*SR));
 const at=quietestPoint(late,SR,3*SR)/SR;expect(at).toBeGreaterThanOrEqual(1);expect(at).toBeLessThanOrEqual(3);
 // Windows place the cut there too.
 const source=Float32Array.from({length:40*SR},(_,i)=>Math.sin(i/3)*.5);source.fill(0,Math.round(28.4*SR),Math.round(28.6*SR));
 const windower=new Windower();windower.push(source);windower.end();const [,second]=drain(windower);expect(second.seam!.cut).toBeCloseTo(28.5,1);
});

it('measures how much of a window is sound above its quiet floor',()=>{
 expect(speechFraction(new Float32Array(30*SR))).toBe(0);
 const bursts=new Float32Array(10*SR);for(let s=0;s<10;s+=2)for(let i=s*SR;i<(s+.5)*SR;i++)bursts[i]=Math.sin(i/5)*.3;
 expect(speechFraction(bursts)).toBeCloseTo(.25,1);
 const hiss=Float32Array.from({length:5*SR},(_,i)=>Math.sin(i*12.9898)*.001);expect(speechFraction(hiss)).toBeLessThan(.01);
});

it('reads the project service’s 16 kHz mono PCM16 WAV chunks',()=>{
 const pcm=Int16Array.from([0,16384,-16384,32767]),bytes=new Uint8Array(44+pcm.byteLength),view=new DataView(bytes.buffer),text=(at:number,s:string)=>[...s].forEach((c,i)=>bytes[at+i]=c.charCodeAt(0));
 text(0,'RIFF');view.setUint32(4,36+pcm.byteLength,true);text(8,'WAVE');text(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,16000,true);view.setUint32(28,32000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,pcm.byteLength,true);bytes.set(new Uint8Array(pcm.buffer),44);
 expect([...wavToPcm(bytes)]).toEqual([0,.5,-.5,32767/32768]);
 view.setUint32(24,44100,true);expect(()=>wavToPcm(bytes)).toThrow(/16 kHz/);
});
