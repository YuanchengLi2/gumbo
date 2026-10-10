import type {CSSProperties} from 'react';
import type {SpineClip,ResolvedClip,ResolvedItem,TimelineDocument} from '@dream/timeline';
export function clipStyle(framing:SpineClip['framing'],motionScale=1,dx=0):CSSProperties{
 const f=framing;const exposure=f?.exposure??0,contrast=f?.contrast??1,saturation=f?.saturation??1,temperature=f?.temperature??0;
 return{width:'100%',height:'100%',objectFit:f?.mode==='fill'||f?.mode==='face'?'cover':'contain',objectPosition:`${(f?.x??.5)*100}% ${(f?.y??.5)*100}%`,opacity:f?.opacity??1,transform:`translateX(${dx}px) rotate(${f?.rotation??0}deg) scale(${(f?.scale??1)*motionScale}) scaleX(${f?.flipX?-1:1}) scaleY(${f?.flipY?-1:1})`,filter:`brightness(${2**exposure}) contrast(${contrast}) saturate(${saturation}) sepia(${Math.abs(temperature)*.35}) hue-rotate(${temperature<0?-20:temperature*10}deg)`};
}
export function gradeFilter(params:Record<string,unknown>){return `brightness(${2**Number(params.exposure??0)}) contrast(${Number(params.contrast??1)}) saturate(${Number(params.saturation??1)})`;}

export function clipStyleAt(clip:ResolvedClip,timeline:TimelineDocument,items:ResolvedItem[],time:number):CSSProperties{
 let scale=1,dx=0,grade='';const frame=Math.max(0,(time-clip.start)*timeline.settings.fps),progress=Math.max(0,Math.min(1,(time-clip.start)/(clip.end-clip.start)));
 for(const item of items){if(item.type!=='effect'||timeline.trackSettings?.['visual:'+item.layer]?.hidden||time<item.timelineStart||time>=item.timelineEnd)continue;const p=item.params;if(item.component==='slow_push')scale*=1+progress*Number(p.amount??.08);if(item.component==='punch_zoom')scale*=1+Number(p.amount??.15);if(item.component==='shake')dx=Math.sin(frame*2.7)*Number(p.amount??.1)*40;if(item.component==='grade')grade+=' '+gradeFilter(p);}
 const style=clipStyle(clip.framing,scale,dx);style.filter=String(style.filter)+grade;return style;
}
