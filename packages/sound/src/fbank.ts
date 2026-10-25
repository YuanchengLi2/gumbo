/** Log mel filterbank energies as Kaldi computes them (torchaudio.compliance.kaldi.fbank's defaults): 25 ms Povey windows
 * every 10 ms, DC removed, pre-emphasis .97, a 512-point FFT, the power spectrum, triangular mel bands from 20 Hz to the
 * Nyquist frequency, no dither, edges snipped. The speaker model was trained on these; beat tracking uses fewer bands. */
export const SAMPLE_RATE=16000,FRAME=400,HOP=160,FFT=512;
const HALF=FFT/2;

const povey=Float64Array.from({length:FRAME},(_,i)=>Math.pow(.5-.5*Math.cos(2*Math.PI*i/(FRAME-1)),.85));
const cos=new Float64Array(HALF),sin=new Float64Array(HALF),reversed=new Uint16Array(FFT);
for(let i=0;i<HALF;i++){cos[i]=Math.cos(2*Math.PI*i/FFT);sin[i]=-Math.sin(2*Math.PI*i/FFT);}
for(let i=1,j=0;i<FFT;i++){let bit=FFT>>1;for(;j&bit;bit>>=1)j^=bit;j^=bit;reversed[i]=j;}

/** The power spectrum (bins 0 to FFT/2-1) of re (im zero), in place: an iterative radix-2 FFT. */
function powerSpectrum(re:Float64Array,im:Float64Array,out:Float64Array){
 for(let i=0;i<FFT;i++){const j=reversed[i];if(j>i){const r=re[i];re[i]=re[j];re[j]=r;const m=im[i];im[i]=im[j];im[j]=m;}}
 for(let size=2;size<=FFT;size<<=1){
  const half=size>>1,step=FFT/size;
  for(let start=0;start<FFT;start+=size)for(let k=0;k<half;k++){
   const t=k*step,a=start+k,b=a+half,xr=re[b]*cos[t]-im[b]*sin[t],xi=re[b]*sin[t]+im[b]*cos[t];
   re[b]=re[a]-xr;im[b]=im[a]-xi;re[a]+=xr;im[a]+=xi;
  }
 }
 for(let k=0;k<HALF;k++)out[k]=re[k]*re[k]+im[k]*im[k];
}

type Band={first:number;last:number;weights:Float64Array};
const bandSets=new Map<number,Band[]>();
/** Kaldi's mel banks: triangles evenly spaced on the mel scale (1127 ln(1 + f/700)), weighted in mel. */
function bands(count:number):Band[]{
 const saved=bandSets.get(count);if(saved)return saved;
 const mel=(f:number)=>1127*Math.log(1+f/700),low=mel(20),high=mel(SAMPLE_RATE/2),delta=(high-low)/(count+1);
 const made=Array.from({length:count},(_,b)=>{
  const left=low+b*delta,center=left+delta,right=center+delta,weights=new Float64Array(HALF);let first=-1,last=-1;
  for(let k=0;k<HALF;k++){const m=mel(k*SAMPLE_RATE/FFT);if(m>left&&m<right){weights[k]=m<=center?(m-left)/(center-left):(right-m)/(right-center);if(first<0)first=k;last=k;}}
  return{first,last,weights};
 });
 bandSets.set(count,made);return made;
}

/** How many frames fbank makes from this many samples. */
export const frameCount=(samples:number)=>samples<FRAME?0:1+Math.floor((samples-FRAME)/HOP);

/** Log mel energies, frames × bands row-major, for 16 kHz mono samples in [-1, 1]. */
export function fbank(samples:Float32Array,count=80):{frames:number;data:Float32Array}{
 const frames=frameCount(samples.length),banks=bands(count),data=new Float32Array(frames*count);
 const re=new Float64Array(FFT),im=new Float64Array(FFT),power=new Float64Array(HALF);
 for(let f=0;f<frames;f++){
  const at=f*HOP;let mean=0;for(let i=0;i<FRAME;i++)mean+=samples[at+i];mean/=FRAME;
  for(let i=0;i<FRAME;i++)re[i]=samples[at+i]-mean;
  for(let i=FRAME-1;i>0;i--)re[i]-=.97*re[i-1];re[0]-=.97*re[0];
  for(let i=0;i<FRAME;i++)re[i]*=povey[i];
  re.fill(0,FRAME);im.fill(0);powerSpectrum(re,im,power);
  for(let b=0;b<count;b++){const {first,last,weights}=banks[b];let e=0;for(let k=first;k<=last;k++)e+=weights[k]*power[k];data[f*count+b]=Math.log(Math.max(e,1.1920929e-7));}
 }
 return{frames,data};
}

/** Each band minus its mean over the frames, in place (the speaker model's input normalisation). */
export function subtractMean(data:Float32Array,frames:number,count:number){
 if(!frames)return data;
 for(let b=0;b<count;b++){let sum=0;for(let f=0;f<frames;f++)sum+=data[f*count+b];const mean=sum/frames;for(let f=0;f<frames;f++)data[f*count+b]-=mean;}
 return data;
}
