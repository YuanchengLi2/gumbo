/** Loudness as EBU R128 measures it (ITU-R BS.1770-4): K-weighting at 48 kHz, the mean square over 400 ms blocks every
 * 100 ms, gated at -70 LUFS and then 10 LU below the ungated level. Fed float planes in pieces as they arrive. The true
 * peak is estimated between samples (4 times oversampled with cubic interpolation), as ffmpeg's ebur128 peak=true does. */
const RATE=48000;
// A high shelf, then the RLB high-pass, as b0 b1 b2 a1 a2 at 48 kHz.
const STAGES=[[1.53512485958697,-2.69169618940638,1.19839281085285,-1.69065929318241,.73248077421585],[1,-2,1,-1.99004745483398,.99007225036621]];
export const lufs=(meanSquare:number)=>-.691+10*Math.log10(meanSquare);

export class LoudnessMeter{
 private filters:number[][][];private squares:number[]=[];private ring:Float64Array;private window=0;private at=0;private filled=0;
 private block=Math.round(RATE*.4);private hop=Math.round(RATE*.1);private last:number[][];
 // Short-term loudness (3 s windows every 100 ms) for the loudness range, EBU Tech 3342.
 private long=RATE*3;private longRing=new Float64Array(RATE*3);private longWindow=0;private shortTerm:number[]=[];
 /** The highest absolute value between samples, linear. */
 truePeak=0;
 constructor(private channels=2){this.filters=Array.from({length:channels},()=>STAGES.map(()=>[0,0,0,0]));this.ring=new Float64Array(this.block);this.last=Array.from({length:channels},()=>[0,0,0]);}
 add(planes:Float32Array[]){
  const n=planes[0]?.length??0;
  for(let i=0;i<n;i++){let sum=0;
   for(let c=0;c<this.channels;c++){
    let x=planes[Math.min(c,planes.length-1)][i];this.peak(c,x);
    for(let s=0;s<STAGES.length;s++){const [b0,b1,b2,a1,a2]=STAGES[s],z=this.filters[c][s],y=b0*x+b1*z[0]+b2*z[1]-a1*z[2]-a2*z[3];z[1]=z[0];z[0]=x;z[3]=z[2];z[2]=y;x=y;}
    sum+=x*x;}
   this.window+=sum-this.ring[this.at];this.ring[this.at]=sum;this.at=(this.at+1)%this.block;
   const slot=this.filled%this.long;this.longWindow+=sum-this.longRing[slot];this.longRing[slot]=sum;this.filled++;
   if(this.filled>=this.block&&(this.filled-this.block)%this.hop===0)this.squares.push(this.window/this.block);
   if(this.filled>=this.long&&(this.filled-this.long)%this.hop===0)this.shortTerm.push(this.longWindow/this.long);
  }
 }
 /** Catmull-Rom between the sample two back and the one before, from the last four: the peak a 4x oversampler would see. */
 private peak(c:number,x:number){
  const [p0,p1,p2]=this.last[c],p3=x;let top=Math.abs(p3);
  for(const t of [.25,.5,.75]){const v=.5*(2*p1+(-p0+p2)*t+(2*p0-5*p1+4*p2-p3)*t*t+(-p0+3*p1-3*p2+p3)*t*t*t);top=Math.max(top,Math.abs(v));}
  if(top>this.truePeak)this.truePeak=top;this.last[c]=[p1,p2,p3];
 }
 /** Integrated loudness in LUFS; -70 for silence. */
 integrated(){
  const absolute=this.squares.filter(z=>lufs(z)>-70);if(!absolute.length)return -70;
  const relative=lufs(absolute.reduce((a,b)=>a+b,0)/absolute.length)-10,gated=absolute.filter(z=>lufs(z)>relative);
  return gated.length?lufs(gated.reduce((a,b)=>a+b,0)/gated.length):-70;
 }
 truePeakDb(){return this.truePeak>0?20*Math.log10(this.truePeak):-Infinity;}
 /** The loudness range in LU, with the levels it spans: the 10th to 95th percentile of the short-term loudness, gated
  * at -70 LUFS and 20 LU below the gated mean. Zero for less than 3 seconds or silence. */
 range(){
  const absolute=this.shortTerm.filter(z=>lufs(z)>-70);if(!absolute.length)return{range:0,threshold:-70,low:-70,high:-70};
  const threshold=lufs(absolute.reduce((a,b)=>a+b,0)/absolute.length)-20,gated=absolute.filter(z=>lufs(z)>threshold).map(lufs).sort((a,b)=>a-b);
  if(!gated.length)return{range:0,threshold,low:-70,high:-70};
  const at=(p:number)=>gated[Math.min(gated.length-1,Math.round((gated.length-1)*p))],low=at(.1),high=at(.95);
  return{range:high-low,threshold,low,high};
 }
}
