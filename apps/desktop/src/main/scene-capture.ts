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

/** Draws one frame of a scene and returns its pixels (BGRA, premultiplied, as Chromium paints them). */
export async function sceneFrame(key:string,source:SceneSource,width:number,height:number,frame:number,fps:number):Promise<ScenePixels>{
 let entry=windows.get(key);if(!entry||entry.window.isDestroyed()){entry=open(source,width,height);windows.set(key,entry);}
 await entry.loaded;const id=++entry.sequence;
 // The request is repeated until the scene says it is ready (its ready message may have gone before this listened);
 // the first answer to this request settles it.
 const answer=await entry.window.webContents.executeJavaScript(`new Promise(resolve=>{
  const state=window.__dreamCapture??=(addEventListener('message',e=>{if(e.data?.dreamScene&&(e.data.ready||e.data.requestId))window.__dreamCapture.ready=true;}),{ready:false});
  const post=()=>postMessage({dreamScene:true,type:'frame',requestId:${id},frame:${Math.max(0,Math.floor(frame))},fps:${Number(fps)||30}},'*');
  const finish=value=>{removeEventListener('message',receive);clearInterval(retry);clearTimeout(limit);resolve(value);};
  const receive=e=>{const d=e.data;if(!d?.dreamScene)return;if(d.ready&&!state.ready){state.ready=true;post();return;}
   if(d.error&&(d.fatal||d.requestId===${id}||d.requestId===undefined))finish({error:String(d.error)});else if(d.requestId===${id})finish({});};
  addEventListener('message',receive);
  const retry=setInterval(()=>{if(!state.ready)post();},250),limit=setTimeout(()=>finish({error:'Frame ${frame} took longer than ${FRAME_TIMEOUT_MS/1000}s to draw.'}),${FRAME_TIMEOUT_MS});
  post();
 })`) as {error?:string};
 if(answer?.error)throw new Error(answer.error);
 const image=await entry.window.webContents.capturePage(),size=image.getSize();
 return{width:size.width,height:size.height,data:image.toBitmap()};
}
export function closeScenes(){for(const {window} of windows.values())if(!window.isDestroyed())window.destroy();windows.clear();}
