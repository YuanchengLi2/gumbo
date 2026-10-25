/** Music's beat, measured: an onset envelope (how much the sound's spectrum jumps up, 100 times a second), the tempo that
 * best explains its rhythm, and the beats themselves by dynamic programming (Ellis 2007, as librosa does it): a beat lands
 * on a strong onset about one period after the last. */
export const ENVELOPE_RATE=100;

/** The spectrum's rise per frame of a log mel spectrogram (frames × bands): the mean increase across bands since the
 * frame before (the last frame of the previous piece, when a long recording is read in pieces). */
export function spectralRise(logMel:Float32Array,frames:number,bands:number,previous?:Float32Array){
 const out=new Float32Array(frames);
 for(let f=0;f<frames;f++){
  const before=f?logMel.subarray((f-1)*bands,f*bands):previous;if(!before)continue;
  let rise=0;for(let b=0;b<bands;b++){const d=logMel[f*bands+b]-before[b];if(d>0)rise+=d;}out[f]=rise/bands;
 }
 return out;
}
/** Onset strength: the rise minus its moving average over about 0.4 s, so a steady loud passage does not read as onsets. */
export function detrend(rise:Float32Array){
 const frames=rise.length,half=20,out=new Float32Array(frames);let sum=0,count=0;
 for(let f=0;f<Math.min(frames,half);f++){sum+=rise[f];count++;}
 for(let f=0;f<frames;f++){
  if(f+half<frames){sum+=rise[f+half];count++;}
  if(f-half-1>=0){sum-=rise[f-half-1];count--;}
  out[f]=Math.max(0,rise[f]-sum/count);
 }
 return out;
}
export const onsetEnvelope=(logMel:Float32Array,frames:number,bands:number)=>detrend(spectralRise(logMel,frames,bands));

const deviation=(values:Float32Array)=>{let sum=0,squares=0;for(const v of values){sum+=v;squares+=v*v;}const mean=sum/(values.length||1);return Math.sqrt(Math.max(0,squares/(values.length||1)-mean*mean));};

/** The tempo in beats per minute: the autocorrelation lag of the envelope that fits best, weighted towards 120 BPM so a
 * beat is not mistaken for half or double itself without reason. */
export function estimateTempo(envelope:Float32Array,{rate=ENVELOPE_RATE,slowest=60,fastest=200}={}){
 const shortest=Math.floor(60*rate/fastest),longest=Math.ceil(60*rate/slowest),n=envelope.length;
 if(n<longest*3)return undefined;
 const ac=new Float64Array(longest+2);
 for(let lag=shortest-1;lag<=longest+1;lag++){let s=0;for(let t=lag;t<n;t++)s+=envelope[t]*envelope[t-lag];ac[lag]=s/(n-lag);}
 let best=0,bestLag=0;
 for(let lag=shortest;lag<=longest;lag++){const bpm=60*rate/lag,weight=Math.exp(-.5*(Math.log2(bpm/120)/1.1)**2),value=ac[lag]*weight;if(value>best){best=value;bestLag=lag;}}
 if(!bestLag||best<=0)return undefined;
 const a=ac[bestLag-1],b=ac[bestLag],c=ac[bestLag+1],curve=a-2*b+c,shift=curve?Math.max(-.5,Math.min(.5,.5*(a-c)/curve)):0;
 return 60*rate/(bestLag+shift);
}

/** Beat times (seconds from the envelope's start) at this tempo. */
export function trackBeats(envelope:Float32Array,bpm:number,{rate=ENVELOPE_RATE,tightness=100}={}){
 const n=envelope.length,period=60*rate/bpm;if(!n||!(period>1))return[];
 // The local score: the envelope over its spread, smoothed with a window as wide as a beat.
 const spread=deviation(envelope)||1,width=Math.round(period),kernel=Array.from({length:2*width+1},(_,i)=>Math.exp(-.5*((i-width)*32/period)**2)),local=new Float64Array(n);
 for(let t=0;t<n;t++){let s=0;for(let k=-width;k<=width;k++){const i=t+k;if(i>=0&&i<n)s+=envelope[i]/spread*kernel[k+width];}local[t]=s;}
 const from=-Math.round(2*period),to=-Math.round(period/2),cumulative=new Float64Array(n),back=new Int32Array(n).fill(-1);
 let maxLocal=0;for(const v of local)maxLocal=Math.max(maxLocal,v);const threshold=.01*maxLocal;let started=false;
 for(let t=0;t<n;t++){
  let best=-Infinity,arg=-1;
  for(let d=from;d<=to;d++){const tau=t+d;if(tau<0)continue;const v=cumulative[tau]-tightness*Math.log(-d/period)**2;if(v>best){best=v;arg=tau;}}
  cumulative[t]=local[t]+(arg>=0?best:0);
  if(!started&&local[t]<threshold)back[t]=-1;else{back[t]=arg;started=true;}
 }
 // The last beat: the last local peak of the cumulative score that is at least half the median peak.
 const peaks:number[]=[];for(let t=1;t<n-1;t++)if(cumulative[t]>cumulative[t-1]&&cumulative[t]>=cumulative[t+1])peaks.push(t);
 if(!peaks.length)return[];
 const sorted=peaks.map(t=>cumulative[t]).sort((a,b)=>a-b),median=sorted[Math.floor(sorted.length/2)];
 let last=peaks[peaks.length-1];for(let i=peaks.length-1;i>=0;i--)if(cumulative[peaks[i]]>=.5*median){last=peaks[i];break;}
 const beats:number[]=[];for(let t=last;t>=0;t=back[t]){beats.push(t);if(back[t]<0)break;}
 beats.reverse();
 // Weak beats at either end (where the music has not started or has faded) are dropped.
 const strength=beats.map(t=>local[t]),rms=Math.sqrt(strength.reduce((s,v)=>s+v*v,0)/(strength.length||1));
 let first=0,end=beats.length;while(first<end&&strength[first]<.5*rms)first++;while(end>first&&strength[end-1]<.5*rms)end--;
 return beats.slice(first,end).map(t=>Math.round(t/rate*1000)/1000);
}
