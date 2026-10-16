import {BrowserWindow} from 'electron';

/** Export's half of coded motion graphics: each scene runs alone in a hidden, transparent window that draws off screen,
 * as the player's sandboxed frame does, and is asked for one frame at a time over the same frame protocol. Its pixels
 * come back with their transparency, so the engine composites them like any other picture. An engine scene loads from
 * dream-engine://; a legacy HTML scene arrives as its finished document. */
export type SceneSource={url:string}|{html:string};
export type ScenePixels={width:number;height:number;data:Uint8Array};
type Entry={window:BrowserWindow;loaded:Promise<void>;sequence:number};
const windows=new Map<string,Entry>();
const FRAME_TIMEOUT_MS=60_000;

function open(source:SceneSource,width:number,height:number):Entry{
 if('url' in source&&!source.url.startsWith('dream-engine://app/scene/'))throw new Error('Only published scenes can be drawn.');
 const window=new BrowserWindow({show:false,frame:false,transparent:true,backgroundColor:'#00000000',width,height,useContentSize:true,
  webPreferences:{offscreen:true,sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true,backgroundThrottling:false}});
 window.webContents.setWindowOpenHandler(()=>({action:'deny'}));window.webContents.on('will-navigate',event=>event.preventDefault());
 window.webContents.setFrameRate(60);
 const url='url' in source?source.url:'data:text/html;charset=utf-8;base64,'+Buffer.from(source.html,'utf8').toString('base64');
 const loaded=window.loadURL(url).then(()=>undefined);loaded.catch(()=>{});
 return{window,loaded,sequence:0};
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
  const finish=value=>{removeEventListener('message',receive);clearInterval(retry);clearTimeout(limit);requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(value)));};
  const receive=e=>{const d=e.data;if(!d?.dreamScene||d.type==='frame')return;if(d.ready){state.ready=true;post();return;}
   if(d.error&&(d.fatal||d.requestId===${id}||d.requestId===undefined))finish({error:String(d.error)});else if(d.requestId===${id})finish({});};
  addEventListener('message',receive);
  const retry=setInterval(()=>{if(!state.ready)post();},250),limit=setTimeout(()=>finish({error:'Frame ${frame} took longer than ${timeoutMs/1000}s to draw.'}),${timeoutMs});
  post();
 })`;
}

/** Draws one frame of a scene and returns its pixels (BGRA, premultiplied, as Chromium paints them). */
export async function sceneFrame(key:string,source:SceneSource,width:number,height:number,frame:number,fps:number):Promise<ScenePixels>{
 let entry=windows.get(key);if(!entry||entry.window.isDestroyed()){entry=open(source,width,height);windows.set(key,entry);}
 await entry.loaded;const id=++entry.sequence;
 const answer=await entry.window.webContents.executeJavaScript(frameRequestScript(id,frame,fps)) as {error?:string};
 if(answer?.error)throw new Error(answer.error);
 const image=await entry.window.webContents.capturePage(),size=image.getSize();
 return{width:size.width,height:size.height,data:image.toBitmap()};
}
export function closeScenes(){for(const {window} of windows.values())if(!window.isDestroyed())window.destroy();windows.clear();}
/** One small still of a scene for the timeline: drawn in its own hidden window, which is closed straight after, and
 * returned as a JPEG data URL the width given. */
export async function sceneStill(source:SceneSource,width:number,height:number,frame:number,fps:number,thumbWidth=240){
 const key='still:'+Math.random().toString(36).slice(2);
 try{await sceneFrame(key,source,width,height,frame,fps);const entry=windows.get(key)!,image=await entry.window.webContents.capturePage();
  return 'data:image/jpeg;base64,'+image.resize({width:thumbWidth,quality:'good'}).toJPEG(80).toString('base64');}
 finally{const entry=windows.get(key);if(entry&&!entry.window.isDestroyed())entry.window.destroy();windows.delete(key);}
}
