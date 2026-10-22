// Runs in Electron's Chromium for tests/gl/style-export.test.ts: Export's own renderVideo on an edit, and the same frames
// drawn as the paused player draws them (the compositor over <video> elements seeked to each layer's source time).
import {renderVideo} from '../../apps/desktop/src/renderer/engine/export';
import {prepare,frameAt,Compositor,type MediaLayer,type Picture} from '../../packages/compositor/src/index';
import type {TimelineDocument} from '../../packages/timeline/src/index';
import type {FootageIndex} from '../../packages/footage/src/index';
const BLOCK=20;
// Export closes the scene windows it drew through the app's preload; this edit has no scenes.
(window as any).dream={closeScenes:async()=>{}};
/** Mean colour of each 20 px block of the canvas, rows from the top. */
function blocks(gl:WebGL2RenderingContext,width:number,height:number){
 const px=new Uint8Array(width*height*4);gl.readPixels(0,0,width,height,gl.RGBA,gl.UNSIGNED_BYTE,px);const out:number[]=[];
 for(let by=0;by<height/BLOCK;by++)for(let bx=0;bx<width/BLOCK;bx++){const sum=[0,0,0];for(let y=by*BLOCK;y<(by+1)*BLOCK;y++)for(let x=bx*BLOCK;x<(bx+1)*BLOCK;x++){const i=((height-1-y)*width+x)*4;for(let c=0;c<3;c++)sum[c]+=px[i+c];}out.push(...sum.map(s=>Math.round(s/(BLOCK*BLOCK))));}
 return out;
}
const once=(el:HTMLVideoElement,event:string)=>new Promise<void>(resolve=>el.addEventListener(event,()=>resolve(),{once:true}));
(window as any).runExport=async(spec:string)=>{
 const {timeline,footage,probes}=JSON.parse(spec) as {timeline:TimelineDocument;footage:FootageIndex;probes:number[]};const {width,height,fps}=timeline.settings;
 const chunks:{data:Uint8Array;position:number}[]=[];let size=0;
 const timing=await renderVideo({timeline,footage,width,height,fps,codec:'h264',quality:'higher',container:'mp4',onProgress:()=>{},signal:new AbortController().signal,
  write:async(data,position)=>{chunks.push({data:data.slice(),position});size=Math.max(size,position+data.length);}});
 const file=new Uint8Array(size);for(const c of chunks)file.set(c.data,c.position);
 const p=prepare({timeline,footage}),canvas=new OffscreenCanvas(width,height),compositor=new Compositor(canvas),gl=(compositor as any).gl as WebGL2RenderingContext,videos=new Map<string,HTMLVideoElement>(),preview:number[][]=[];
 for(const time of probes){const frame=frameAt(p,time),pictures=new Map<MediaLayer,Picture>();
  for(const layer of frame.layers){if(layer.kind!=='media'||layer.media!=='video')continue;let v=videos.get(layer.key);
   if(!v){v=document.createElement('video');v.muted=true;v.crossOrigin='anonymous';v.preload='auto';v.src=`dream-media://${layer.assetId}/play`;videos.set(layer.key,v);await once(v,'loadeddata');}
   if(Math.abs(v.currentTime-layer.time)>1e-6){const seeked=once(v,'seeked');v.currentTime=layer.time;await seeked;}pictures.set(layer,v);}
  compositor.draw(frame,layer=>pictures.get(layer));preview.push(blocks(gl,width,height));}
 let binary='';for(let i=0;i<file.length;i+=32768)binary+=String.fromCharCode(...file.subarray(i,i+32768));
 return{video:btoa(binary),timing,preview};
};
(window as any).ready=true;
