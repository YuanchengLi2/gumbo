import type {MediaLayer} from '@dream/compositor';

/** How far ahead the preview gets clips ready: every clip that starts within this window is loaded and parked on its first
 * frame, so its cut shows at once. */
export const LOOKAHEAD_SEC=1;
/** A cut whose next clip picks up its source within this of where the playing video will be is the same shot going on: the
 * playing video carries on into it instead of a second one being parked there. */
export const CONTINUE_SEC=.1;

/** A clip that comes into the frame in the window: its layer on the first frame it shows, that frame, and the clips showing
 * on the frame before it and on its own first frame. */
export type Arrival={layer:MediaLayer;frame:number;before:Set<string>;during:Set<string>};

/** Every clip that starts showing after frame `from` up to frame `to`, in order, however short: a clip that starts and ends
 * between two checks is found too. layersAt gives the media layers a frame shows. */
export function upcoming(layersAt:(frame:number)=>MediaLayer[],from:number,to:number):Arrival[]{
 const seen=new Set(layersAt(from).map(l=>l.key)),arrivals:Arrival[]=[];let before=seen;
 for(let frame=from+1;frame<=to;frame++){
  const layers=layersAt(frame),during=new Set(layers.map(l=>l.key));
  for(const layer of layers)if(!seen.has(layer.key)){seen.add(layer.key);arrivals.push({layer,frame,before,during});}
  before=during;
 }
 return arrivals;
}

/** Whether a clip arriving at a cut continues the shot a playing clip shows: the same source, the playing clip leaves on
 * that very frame, and the source picks up within CONTINUE_SEC of where the playing video will be by then. */
export function continues(playing:MediaLayer,arrival:Arrival,now:number,fps:number){
 if(playing.media!=='video'||arrival.layer.media!=='video'||playing.assetId!==arrival.layer.assetId||playing.rate<=0)return false;
 if(!arrival.before.has(playing.key)||arrival.during.has(playing.key))return false;
 const there=playing.time+(arrival.frame/fps-now)*playing.rate;
 return Math.abs(there-arrival.layer.time)<=CONTINUE_SEC;
}

/** How many video elements each source needs at once over `span` seconds from `from`: the most of its clips that show or
 * get ready (from LOOKAHEAD_SEC before they start) at the same moment. A clip that continues the shot before it is
 * counted too, so this may be one more than playback takes. */
export function videoPool(clips:{assetId:string;start:number;end:number}[],from:number,span:number){
 const edges=new Map<string,[number,number][]>();
 for(const c of clips){if(c.end<=from||c.start>from+span)continue;let list=edges.get(c.assetId);if(!list)edges.set(c.assetId,list=[]);list.push([Math.max(from,c.start-LOOKAHEAD_SEC),1],[c.end,-1]);}
 const pool=new Map<string,number>();
 // A clip that ends as another's window opens is not counted with it.
 for(const [asset,list] of edges){list.sort((a,b)=>a[0]-b[0]||a[1]-b[1]);let n=0,most=0;for(const [,d] of list){n+=d;most=Math.max(most,n);}pool.set(asset,most);}
 return pool;
}

export type PooledVideo={key:string;assetId:string;el:{currentTime:number}};
/** The video element a clip draws from: the one already showing it; else one of the same source that nothing needs this
 * moment, the one whose playhead is nearest the clip's (a cut that continues the shot takes the playing video on, a jump cut
 * reuses a loaded one and only seeks it); else none, and a new one is loaded. claimed: elements taken this moment; needed:
 * the clips showing now or getting ready, whose elements are not free to take. */
export function pickVideo<V extends PooledVideo>(videos:Iterable<V>,layer:{key:string;assetId:string;time:number},claimed:Set<V>,needed:Set<string>):V|undefined{
 let best:V|undefined;
 for(const v of videos){
  if(claimed.has(v))continue;
  if(v.key===layer.key&&v.assetId===layer.assetId)return v;
  if(v.assetId!==layer.assetId||needed.has(v.key))continue;
  if(!best||Math.abs(v.el.currentTime-layer.time)<Math.abs(best.el.currentTime-layer.time))best=v;
 }
 return best;
}
