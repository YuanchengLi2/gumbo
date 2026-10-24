import type {TextLayer} from '@dream/compositor';

/** The free plan's mark: "Edited with Gumbo", small in the bottom-right corner over the last seconds of an export, fading
 * in. It is a text layer like any other, drawn by the same compositor, so it looks the same at every size and shape. Paid
 * plans export without it. */
export const WATERMARK_TEXT='Edited with Gumbo',WATERMARK_SECONDS=2.5;
const PAID=new Set(['pro','max','max20']);
/** Whether an export carries the mark: everyone but a paid plan (signed out, the free plan, a guest). */
export const watermarked=(plan?:string)=>!PAID.has(plan??'');

/** The mark at `time` (seconds) of an edit `duration` long in a `width` x `height` frame, or nothing before it shows. */
export function watermarkLayer(time:number,duration:number,width:number,height:number):TextLayer|undefined{
 const from=Math.max(0,duration-WATERMARK_SECONDS);if(time<from)return undefined;
 const short=Math.min(width,height),fontSize=Math.max(14,Math.round(short*.03)),margin=short*.035;
 // Centred text: its middle sits a margin and half its (estimated) width in from the right edge.
 const half=fontSize*.29*WATERMARK_TEXT.length;
 return{kind:'text',key:'gumbo-watermark',component:'text',text:WATERMARK_TEXT,x:(width-margin-half)/width,y:(height-margin-fontSize/2)/height,rotation:0,scale:1,
  opacity:.88*Math.min(1,(time-from)/.4),color:'#ffffff',fontSize,fontWeight:600,shadow:'rgba(0,0,0,.55)',shadowBlur:Math.round(fontSize/3),shadowX:0,shadowY:Math.max(1,Math.round(fontSize/14))};
}
