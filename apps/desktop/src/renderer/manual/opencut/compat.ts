/** Gumbo adapter for the imported OpenCut algorithms; supported project FPS divide 60,000. */
export type MediaTime=number;
export type FrameRate={numerator:number;denominator:number};
export type ElementRef={trackId:string;elementId:string};
export type RetimeConfig={speed:number};
export const TICKS_PER_SECOND=60000;
export const ZERO_MEDIA_TIME=0;
export const mediaTime=({ticks}:{ticks:number})=>ticks;
export const addMediaTime=({a,b}:{a:number;b:number})=>a+b;
export const subMediaTime=({a,b}:{a:number;b:number})=>a-b;
export const minMediaTime=({a,b}:{a:number;b:number})=>Math.min(a,b);
export const maxMediaTime=({a,b}:{a:number;b:number})=>Math.max(a,b);
export const clampMediaTime=({time,min,max}:{time:number;min:number;max:number})=>Math.max(min,Math.min(max,time));
export const roundMediaTime=({time}:{time:number})=>Math.round(time);
export const frameRateToFloat=(fps:FrameRate)=>fps.numerator/fps.denominator;
export const roundFrameTicks=({ticks,fps}:{ticks:number;fps:FrameRate})=>Math.round(ticks/TICKS_PER_SECOND*frameRateToFloat(fps))*TICKS_PER_SECOND/frameRateToFloat(fps);
export const getSourceSpanAtClipTime=({clipTime,retime}:{clipTime:number;retime:RetimeConfig})=>clipTime*retime.speed;
export const getTimelineDurationForSourceSpan=({sourceSpan,retime}:{sourceSpan:number;retime:RetimeConfig})=>sourceSpan/retime.speed;
