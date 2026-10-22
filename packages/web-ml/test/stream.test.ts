import {it,expect} from 'vitest';
import {WordSchema} from '@dream/footage';
import {StreamTranscription,localWords,SAMPLE_RATE,type DecodeWindow,type LocalWord} from '../src';

const SR=SAMPLE_RATE;
const TEXT='four score and seven years ago our fathers brought forth on this continent a new nation conceived in liberty and dedicated to the proposition that all men are created equal now we are engaged in a great civil war testing whether that nation or any nation so conceived and so dedicated can long endure we are met on a great battlefield of that war we have come to dedicate a portion of that field as a final resting place for those who here gave their lives that that nation might live';
/** Ground truth: a word every 0.6 s (0.3 s long) with a pause after every twelfth, over sound with a quiet floor. */
function speech(gapAt:[number,number]=[0,0]){
 const words:{word:string;start:number;end:number}[]=[];let at=.5;
 for(const [i,word] of TEXT.split(' ').entries()){if(at>=gapAt[0]&&at<gapAt[1])at=gapAt[1];words.push({word,start:at,end:at+.3});at+=i%12===11?1.2:.6;}
 const seconds=Math.ceil(at+1),audio=Float32Array.from({length:seconds*SR},(_,i)=>Math.sin(i*12.9898)*.002);
 for(const w of words)for(let i=Math.round(w.start*SR);i<w.end*SR;i++)audio[i]=Math.sin(i/4)*.3;
 return{words,audio};
}
/** Whisper as the stream sees it: the words in the window, times off by up to ±0.1 s, a word cut by the window's edge
 * sometimes heard (clipped) and sometimes not, and nothing at all where the window is silent. */
function fakeWhisper(truth:{word:string;start:number;end:number}[],audio:Float32Array,calls:number[]=[]):DecodeWindow{
 return async(samples,{signal})=>{
  await new Promise(r=>setTimeout(r,1));signal.throwIfAborted();
  const start=Math.round(indexOf(audio,samples)/SR*1000)/1000,end=start+samples.length/SR;calls.push(start);
  const words=truth.filter((w,i)=>w.end>start&&w.start<end&&(w.start>=start&&w.end<=end||i%2===0)).map((w,i)=>{const jitter=Math.sin(i*7.1+start)*.1;
   return{word:w.word,start:Math.max(0,w.start-start+jitter),end:Math.min(end-start,w.end-start+jitter),probability:.9};});
  return{words,language:'en',languageProbability:.98,noSpeechProb:.01,avgLogprob:-.2,tokens:words.length,truncated:false};
 };
}
const indexOf=(audio:Float32Array,window:Float32Array)=>{for(let at=0;at<audio.length;at+=SR/10){let same=true;for(let i=0;i<64&&same;i++)same=audio[at+i]===window[i];if(same)return at;}throw new Error('window not found');};
const text=(words:{word:string}[])=>words.map(w=>w.word).join(' ');

it('transcribes a long stream window by window, once per word, settling words as it goes',async()=>{
 const {words:truth,audio}=speech(),settled:LocalWord[][]=[],progress:number[]=[];let most=0;
 const stream=new StreamTranscription(fakeWhisper(truth,audio),{onWords:w=>settled.push(w),onProgress:s=>progress.push(s)});
 // Pushed a second at a time, as a decoder would; the stream never holds much more than a window.
 for(let at=0;at<audio.length;at+=SR){stream.push(audio.subarray(at,at+SR));most=Math.max(most,stream.buffered);await new Promise(r=>setTimeout(r,2));}
 // Two windows' worth of words were settled before the audio ended.
 expect(settled.length).toBe(2);
 const result=await stream.end();
 expect(text(result.words)).toBe(TEXT);
 expect(settled.flat()).toEqual(result.words);
 for(const [i,w] of result.words.entries()){expect(Math.abs(w.start-truth[i].start)).toBeLessThan(.15);expect(w.language).toBe('english');}
 expect(result).toMatchObject({language:'english',languageCode:'en',durationSec:audio.length/SR});
 expect(most).toBeLessThanOrEqual(31*SR);
 expect(progress.at(-1)).toBe(audio.length/SR);
 // Segments tile the audio, one per window, and every word sits in one.
 expect(result.segments[0].start).toBe(0);expect(result.segments.at(-1)!.end).toBe(result.durationSec);
 for(let i=1;i<result.segments.length;i++)expect(result.segments[i].start).toBe(result.segments[i-1].end);
 expect(result.segments.map(s=>s.text).join(' ')).toBe(TEXT);
 // As stored project words.
 const stored=localWords('asset-1',result.words,{offset:10});
 expect(stored).toHaveLength(truth.length);for(const w of stored)expect(()=>WordSchema.parse(w)).not.toThrow();
 expect(stored[0]).toMatchObject({id:'asset-1:whisper:0',assetId:'asset-1',text:'four',confidence:.9,speaker:'unknown',language:'english'});
 expect(stored[0].start).toBeGreaterThan(10);expect(stored[1].pauseBefore).toBeCloseTo(.15,0);
});

it('does not decode a silent window, and keeps the words heard either side of it',async()=>{
 const {words:truth,audio}=speech([50,84]),calls:number[]=[];
 const stream=new StreamTranscription(fakeWhisper(truth,audio,calls));stream.push(audio);
 const result=await stream.end();
 expect(text(result.words)).toBe(TEXT);
 expect(calls).toEqual([0,26,78]);expect(result.segments[2].text).toBe('');
});

it('cancels: the decoder sees the abort and the result rejects',async()=>{
 const {words:truth,audio}=speech(),controller=new AbortController(),calls:number[]=[];
 const stream=new StreamTranscription(fakeWhisper(truth,audio,calls),{},controller.signal);
 stream.push(audio.subarray(0,40*SR));await new Promise(r=>setTimeout(r,0));controller.abort();
 await expect(stream.end()).rejects.toThrow(/abort/i);
 expect(()=>stream.push(audio.subarray(0,SR))).toThrow(/abort/i);
 expect(calls.length).toBeLessThanOrEqual(1);
});

it('drops a window Whisper itself calls silence, and rejects a language it does not know',async()=>{
 const {audio}=speech(),decode:DecodeWindow=async()=>({words:[{word:'Thank',start:1,end:1.2,probability:.2},{word:'you.',start:1.2,end:1.5,probability:.2}],language:'en',languageProbability:.5,noSpeechProb:.9,avgLogprob:-1.4,tokens:3,truncated:false});
 const stream=new StreamTranscription(decode);stream.push(audio.subarray(0,20*SR));
 expect((await stream.end()).words).toEqual([]);
 expect(()=>new StreamTranscription(decode,{language:'klingon'})).toThrow(/klingon/);
 expect(()=>new StreamTranscription(decode,{language:'Vietnamese'})).not.toThrow();
});

it('passes a decoder failure to the caller and stops',async()=>{
 const {audio}=speech(),stream=new StreamTranscription(async()=>{throw new Error('GPU lost');});
 stream.push(audio.subarray(0,35*SR));
 await expect(stream.end()).rejects.toThrow('GPU lost');
});
