import {Input,UrlSource,ALL_FORMATS,CanvasSink} from 'mediabunny';

/** Decodes the frames filmstrips and chat tiles show, off the window's thread: a frame is drawn on a canvas the graphics
 * card owns, and reading it back for its picture waits for everything the card is doing, which with a 4K source held
 * the window for a tenth of a second a frame. One decoder per playback copy and height. */
type Ask={id:number;url:string;height:number;quality:number;times:number[]};
const scope=self as unknown as {onmessage:(e:MessageEvent<Ask>)=>void;postMessage:(message:unknown)=>void};
const sinks=new Map<string,Promise<CanvasSink|undefined>>();
const sinkFor=(url:string,height:number)=>{const key=url+'|'+height;let sink=sinks.get(key);
 if(!sink){sink=(async()=>{const track=await new Input({source:new UrlSource(url),formats:ALL_FORMATS}).getPrimaryVideoTrack();
  if(!track||!await track.canDecode())return undefined;return new CanvasSink(track,{height,fit:'contain'});})().catch(()=>undefined);sinks.set(key,sink);}
 return sink;};
async function answer({id,url,height,quality,times}:Ask){
 try{const sink=await sinkFor(url,height);if(!sink){scope.postMessage({id,failed:true});return;}
  // One answer per requested time, in order (null past the end of the video).
  const frames:[number,Blob][]=[];let n=0;for await(const wrapped of sink.canvasesAtTimestamps(times)){const at=times[n++];if(wrapped&&at!==undefined)frames.push([at,await (wrapped.canvas as OffscreenCanvas).convertToBlob({type:'image/jpeg',quality})]);}
  scope.postMessage({id,frames});}
 catch{scope.postMessage({id,failed:true});}
}
// One batch at a time: decoders running side by side for every strip and tile kept the graphics card busy enough to
// hold back the window's frames (4K sources most).
let queue=Promise.resolve();
scope.onmessage=({data})=>{queue=queue.then(()=>answer(data));};
