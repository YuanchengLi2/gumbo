import {BrowserWindow,type NativeImage} from 'electron';

/** Export's half of coded motion graphics: each scene runs alone in a hidden, transparent window that draws off screen,
 * as the player's sandboxed frame does, and is asked for one frame at a time over the same frame protocol. Its pixels
 * come back with their transparency, so the engine composites them like any other picture. An engine scene loads from
 * dream-engine://; a legacy HTML scene arrives as its finished document.
 *
 * The pictures are the window's own paints, not screenshots: an off-screen window hands over each frame it paints, and
 * paints only when something on the page changed. So a frame that looks like the one before (a title holding still,
 * most of a lower third's life) costs no capture, no copy and no upload: the caller is told it is unchanged and keeps
 * the picture it has. Before, every frame was captured and sent whole, about 75 ms each, identical or not. */
export type SceneSource={url:string}|{html:string};
/** paint names the picture; data is left out when it is the picture the caller already has (its since). */
/** logs: what the scene's code printed (console.log, warnings, errors) while this frame was drawn, for the agent. */
export type ScenePixels={width:number;height:number;paint:number;data?:Uint8Array;logs?:string[]};
type Entry={window:BrowserWindow;loaded:Promise<void>;sequence:number;paints:Paints;logs:string[]};
const windows=new Map<string,Entry>();
const FRAME_TIMEOUT_MS=60_000;
// The windows draw at 240 frames a second (the most Chromium allows), so waiting for the next frame is about 4 ms.
const FRAME_RATE=240;
// How long a paint may take to arrive after the page has drawn the frame: about five frames. Past that, nothing changed.
export const SETTLE_MS=20;
// How long a frame that changed the page may take to paint before the capture stops waiting for it.
export const CHANGED_WAIT_MS=1000;
// After asking a window that missed its paint to paint again, how long to wait for that paint.
export const REPAINT_WAIT_MS=1500;

let paintNumber=0;
/** A window's paints: the latest picture and its number. Numbers count across every window, so a picture's number never
 * names a picture from another window or an earlier one with the same key. */
export class Paints{
 latest?:{image:NativeImage;number:number};private waiter?:()=>void;
 add(image:NativeImage){this.latest={image,number:++paintNumber};this.waiter?.();}
 get number(){return this.latest?.number??0;}
 /** Settles at the next paint, or after ms with none. */
 next(ms:number){return new Promise<void>(resolve=>{const done=()=>{clearTimeout(timer);this.waiter=undefined;resolve();},timer=setTimeout(done,ms);this.waiter=done;});}
}

function open(source:SceneSource,width:number,height:number):Entry{
 if('url' in source&&!source.url.startsWith('dream-engine://app/scene/'))throw new Error('Only published scenes can be drawn.');
 // One pixel per scene pixel whatever the display's scaling: a 1920x1080 scene is 1920x1080 pictures, not 2880x1620 at 150%.
 const window=new BrowserWindow({show:false,frame:false,transparent:true,backgroundColor:'#00000000',width,height,useContentSize:true,
  webPreferences:{offscreen:{deviceScaleFactor:1},sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true,backgroundThrottling:false}});
 window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',event=>event.preventDefault());
 const paints=new Paints(),logs:string[]=[];window.webContents.on('paint',(_event,_dirty,image)=>paints.add(image));
 // What the scene's code prints, so the agent can debug a scene the way a developer reads its console.
 window.webContents.on('console-message',(...args:any[])=>{const details=args[0],message=String(details?.message??args[2]??'').trim(),level=String(details?.level??args[1]??'');if(!message)return;logs.push(((/warn|^2$/.test(level)?'warning: ':/error|^3$/.test(level)?'error: ':'')+message).slice(0,240));if(logs.length>200)logs.splice(0,logs.length-200);});
 window.webContents.setFrameRate(FRAME_RATE);
 const url='url' in source?source.url:'data:text/html;charset=utf-8;base64,'+Buffer.from(source.html,'utf8').toString('base64');
 const loaded=window.loadURL(url).then(()=>undefined);loaded.catch(()=>{});
 return{window,loaded,sequence:0,paints,logs};
}

/** The page script that asks a scene for one frame and settles when the scene has drawn it. The scene is the window's own
 * page, so this script hears its own frame requests too: they carry the request id, and counting one as the scene's
 * answer captured the page before the scene had drawn (a title's first frame, or nothing on a scene still loading), so
 * requests are never answers. The request is repeated until the scene says it is ready (its ready message may have gone
 * before this listened), and sent again on every ready message: a scene that mounts after the first request missed it,
 * and the window-wide listener below has already marked it ready by the time this request hears the message. The first
 * answer to this request settles it. */
export function frameRequestScript(id:number,frame:number,fps:number,timeoutMs=FRAME_TIMEOUT_MS){
 return `new Promise(resolve=>{
  const state=window.__dreamCapture??=(addEventListener('message',e=>{if(e.data?.dreamScene&&e.data.type!=='frame'&&(e.data.ready||e.data.requestId))window.__dreamCapture.ready=true;}),{ready:false});
  const post=()=>postMessage({dreamScene:true,type:'frame',requestId:${id},frame:${Math.max(0,Math.floor(frame))},fps:${Number(fps)||30}},'*');
  // The scene has drawn the frame into its page, but the window paints it on its next frame: answering at once captured
  // the frame before (blank for a scene's first frame, so the agent and Export missed graphics that were there).
  // Whether the frame changed anything on the page: a change to the page's elements, or a canvas or video (they draw
  // without one). Unchanged, the picture already painted is this frame; changed, its paint must be waited for.
  let mutated=false;const changes=typeof MutationObserver==='function'&&typeof document!=='undefined'?new MutationObserver(()=>{mutated=true;}):null;
  changes?.observe(document,{subtree:true,childList:true,attributes:true,characterData:true});
  const finish=value=>{removeEventListener('message',receive);clearInterval(retry);clearTimeout(limit);requestAnimationFrame(()=>requestAnimationFrame(()=>{const changed=!changes||mutated||!!document.querySelector('canvas,video');changes?.disconnect();resolve({...value,changed});}));};
  const receive=e=>{const d=e.data;if(!d?.dreamScene||d.type==='frame')return;if(d.ready){state.ready=true;post();return;}
   if(d.error&&(d.fatal||d.requestId===${id}||d.requestId===undefined))finish({error:String(d.error)});else if(d.requestId===${id})finish({});};
  addEventListener('message',receive);
  const retry=setInterval(()=>{if(!state.ready)post();},250),limit=setTimeout(()=>finish({error:'Frame ${frame} took longer than ${timeoutMs/1000}s to draw.'}),${timeoutMs});
  post();
 })`;
}

/** Draws one frame of a scene and returns its pixels (BGRA, premultiplied, as Chromium paints them), or only the number of
 * the picture when it is since, the one the caller already has. */
export async function sceneFrame(key:string,source:SceneSource,width:number,height:number,frame:number,fps:number,since?:number):Promise<ScenePixels>{
 let entry=windows.get(key);if(!entry||entry.window.isDestroyed()){entry=open(source,width,height);windows.set(key,entry);}
 await entry.loaded;const id=++entry.sequence,before=entry.paints.number,printed=entry.logs.length;
 const answer=await entry.window.webContents.executeJavaScript(frameRequestScript(id,frame,fps)) as {error?:string;changed?:boolean};
 if(answer?.error)throw new Error(answer.error);
 const lines=entry.logs.slice(printed).slice(-8);
 return{...await framePicture(entry,before,answer?.changed,since,frame),...(lines.length?{logs:lines}:{})};
}
/** The picture of a frame the scene has drawn. A frame that changed the page is waited for until its paint lands (a big
 * drawing can take well past a few frames to paint, and returning early handed back the picture before it, so the agent
 * saw a scene's drawings blank and spent a long edit "fixing" them). A frame that changed nothing gets a few frames' grace
 * and is then the picture already painted. A window that missed its paint is asked to paint again; if it still does not,
 * the frame fails with that reason. It used to be screenshotted instead, and an off-screen window's screenshot is solid
 * black: the agent saw a paper card the player drew perfectly as an opaque black frame and rebuilt it again and again,
 * and Export could have put that black frame in the video. */
export async function framePicture(entry:{paints:Paints;window:{webContents:{invalidate():void}}},before:number,changed:boolean|undefined,since:number|undefined,frame:number):Promise<ScenePixels>{
 if(entry.paints.number===before)await entry.paints.next(changed!==false?CHANGED_WAIT_MS:SETTLE_MS);
 if(entry.paints.number===before&&(changed!==false||!entry.paints.latest)){entry.window.webContents.invalidate();await entry.paints.next(REPAINT_WAIT_MS);}
 const latest=entry.paints.latest,painted=entry.paints.number!==before;
 if(!latest||(!painted&&changed!==false))throw new Error(`its frame ${frame} was drawn but never painted, so there is no picture of it (an engine problem, not the scene's code; looking again usually works).`);
 const size=latest.image.getSize();
 return latest.number===since?{width:size.width,height:size.height,paint:latest.number}:{width:size.width,height:size.height,paint:latest.number,data:latest.image.toBitmap()};
}
export function closeScenes(){for(const {window} of windows.values())if(!window.isDestroyed())window.destroy();windows.clear();}
/** One small still of a scene for the timeline: drawn in its own hidden window, which is closed straight after, and
 * returned as a JPEG data URL the width given. */
export async function sceneStill(source:SceneSource,width:number,height:number,frame:number,fps:number,thumbWidth=240){
 const key='still:'+Math.random().toString(36).slice(2);
 // The window's own painted picture of the frame (sceneFrame makes sure there is one); a screenshot of an off-screen
 // window is solid black.
 try{await sceneFrame(key,source,width,height,frame,fps);const image=windows.get(key)!.paints.latest!.image;
  return 'data:image/jpeg;base64,'+image.resize({width:thumbWidth,quality:'good'}).toJPEG(80).toString('base64');}
 finally{const entry=windows.get(key);if(entry&&!entry.window.isDestroyed())entry.window.destroy();windows.delete(key);}
}
