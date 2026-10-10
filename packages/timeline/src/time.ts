export const SAMPLE_RATE=48000;
export const secondsToFrames=(seconds:number,fps:number)=>Math.round(seconds*fps);
export const framesToSeconds=(frames:number,fps:number)=>frames/fps;
export const secondsToSamples=(seconds:number,rate=SAMPLE_RATE)=>Math.round(seconds*rate);
export const samplesToSeconds=(samples:number,rate=SAMPLE_RATE)=>samples/rate;
export const sequenceFrame=(sourceSec:number,sourceFps:number,frameCount:number)=>Math.max(0,Math.min(frameCount-1,Math.floor(sourceSec*sourceFps+1e-7)));
export type SourceTimePoint={sourceSec:number;proxySec:number;sourceFrame?:number};
export function mapTime(value:number,points:SourceTimePoint[],direction:'sourceToProxy'|'proxyToSource'='sourceToProxy'){if(!points.length)return value;const input=direction==='sourceToProxy'?'sourceSec':'proxySec',output=direction==='sourceToProxy'?'proxySec':'sourceSec';const right=points.findIndex(p=>p[input]>value);const a=points[Math.max(0,right<0?points.length-2:right-1)],b=points[Math.min(points.length-1,right<0?points.length-1:right)];if(!a||!b||a[input]===b[input])return a?.[output]??value;return a[output]+(value-a[input])/(b[input]-a[input])*(b[output]-a[output]);}
