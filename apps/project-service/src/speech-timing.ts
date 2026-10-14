/** Word timings checked against the sound itself. Whisper stretches a word across the silence or music next to it: in the
 * Northern Vietnam vlog "made" ran from 1.7 s to 15.4 s and "I" sat 13 s before it, so captions built from the transcript
 * drifted by seconds ("I made it" stretched across 15 seconds). Each word is pulled onto the speech actually heard in its
 * span, kept no longer than a spoken word can last, and a word with no speech under it moves next to the word it was
 * stretched towards. Deterministic and local: no model call. */
export type SpeechMask={frameSec:number;active:Uint8Array};
export type TimedWord={word:string;start:number;end:number};

/** Which 20 ms frames of a 16 kHz mono PCM16 WAV hold sound well above its own quiet floor (the 20th percentile level). */
export function speechMask(wav:Uint8Array):SpeechMask|undefined{
 const view=new DataView(wav.buffer,wav.byteOffset,wav.byteLength),tag=(at:number)=>String.fromCharCode(wav[at],wav[at+1],wav[at+2],wav[at+3]);
 if(wav.length<44||tag(0)!=='RIFF'||tag(8)!=='WAVE')return undefined;
 let at=12,data=-1,size=0;while(at+8<=wav.length){const length=view.getUint32(at+4,true);if(tag(at)==='data'){data=at+8;size=Math.min(length,wav.length-data);break;}at+=8+length+(length%2);}
 if(data<0)return undefined;
 const frame=320,count=Math.floor(size/2/frame),levels=new Float64Array(count);
 for(let f=0;f<count;f++){let sum=0;for(let i=0;i<frame;i++){const v=view.getInt16(data+(f*frame+i)*2,true)/32768;sum+=v*v;}levels[f]=10*Math.log10(sum/frame+1e-10);}
 const sorted=[...levels].sort((a,b)=>a-b),floor=sorted[Math.floor(sorted.length*.2)]??-100,threshold=Math.max(floor+10,-50);
 const active=new Uint8Array(count);for(let f=0;f<count;f++)active[f]=levels[f]>threshold?1:0;
 // Bridge gaps shorter than 120 ms (between syllables) and drop blips shorter than 60 ms.
 for(let f=0;f<count;){if(active[f]){f++;continue;}let g=f;while(g<count&&!active[g])g++;if(f>0&&g<count&&g-f<6)active.fill(1,f,g);f=g;}
 for(let f=0;f<count;){if(!active[f]){f++;continue;}let g=f;while(g<count&&active[g])g++;if(g-f<3)active.fill(0,f,g);f=g;}
 return{frameSec:.02,active};
}
/** How long a word can take to say: about 80 ms a letter plus 300 ms, never over 2 s. */
export const longestWord=(word:string)=>Math.min(2,.3+.08*word.replace(/[^\p{L}\p{N}]/gu,'').length);

export function fitToSpeech<T extends TimedWord>(words:T[],mask?:SpeechMask):T[]{
 const out=words.map(w=>({...w}));
 const heard=(start:number,end:number)=>{if(!mask)return undefined;const a=Math.max(0,Math.floor(start/mask.frameSec)),b=Math.min(mask.active.length,Math.ceil(end/mask.frameSec));let first=-1,last=-1;for(let f=a;f<b;f++)if(mask.active[f]){if(first<0)first=f;last=f;}return first<0?null:{start:first*mask.frameSec,end:(last+1)*mask.frameSec};};
 for(let n=out.length-1;n>=0;n--){
  const w=out[n],original=words[n],next=out[n+1],max=longestWord(w.word);
  // Whisper fills a gap by stretching the word before it, so a stretched word that ran up to the next word belongs at its end.
  const towardsNext=!!next&&Math.abs(original.end-words[n+1].start)<.05;
  let start=w.start,end=w.end;const span=heard(start,end);
  if(span===null){if(towardsNext){end=next.start;start=Math.max(original.start,end-Math.min(max,end-original.start)*.6);}else end=Math.min(end,start+max);}
  else if(span){start=Math.max(start,span.start-.04);end=Math.min(end,span.end+.04);}
  if(end-start>max){if(towardsNext)start=end-max;else end=start+max;}
  if(next&&end>next.start)end=next.start;
  if(end-start<.05)start=Math.max(0,end-.05);
  w.start=Math.round(start*1000)/1000;w.end=Math.round(end*1000)/1000;
 }
 return out;
}
