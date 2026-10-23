/** Scene pictures for Export, Roux's view of an edit and timeline stills (the desktop paints them in hidden windows,
 * main/scene-capture.ts). Each scene runs here in a page of its own, the same scene page the player shows, told which
 * frame to draw; then the page draws itself into a picture (public/engine/host.js), returned as the desktop returns
 * it: BGRA, premultiplied. The pages sit behind the app, transparent but on screen, because a browser slows the
 * animation frames of a page that is out of sight. A legacy HTML scene cannot draw itself and says so. */
type Source={url:string}|{html:string};
type Waiter={resolve:(value:any)=>void;reject:(error:Error)=>void;timer:ReturnType<typeof setTimeout>};
type Page={iframe:HTMLIFrameElement;ready:Promise<void>;waiting:Map<number,Waiter>;next:number;onReady?:()=>void;onFail?:(error:Error)=>void;failed?:Error};
const pages=new Map<string,Page>(),FRAME_TIMEOUT_MS=60_000;let paints=0,holder:HTMLDivElement|undefined,listening=false;

function receive(event:MessageEvent){
 const data=event.data;if(!data?.dreamScene)return;
 for(const page of pages.values()){
  if(event.source!==page.iframe.contentWindow)continue;
  if(data.ready){page.onReady?.();return;}
  if(data.error&&data.fatal&&data.requestId===undefined){page.failed=new Error(String(data.error));page.onFail?.(page.failed);for(const w of page.waiting.values()){clearTimeout(w.timer);w.reject(page.failed);}page.waiting.clear();return;}
  const waiter=page.waiting.get(data.requestId);if(!waiter)return;page.waiting.delete(data.requestId);clearTimeout(waiter.timer);
  data.error?waiter.reject(new Error(String(data.error))):waiter.resolve(data);return;
 }
}
function open(key:string,source:Source,width:number,height:number):Page{
 const found=pages.get(key);if(found)return found;
 if(!listening){addEventListener('message',receive);listening=true;}
 if(!holder){holder=document.createElement('div');holder.setAttribute('aria-hidden','true');holder.style.cssText='position:fixed;left:0;top:0;width:0;height:0;opacity:0;pointer-events:none;z-index:-1;overflow:visible';document.body.append(holder);}
 if(!('url' in source))throw new Error('This older kind of scene can only be drawn by the desktop app; ask Gumbo to rebuild it as an engine scene.');
 const iframe=document.createElement('iframe');iframe.setAttribute('sandbox','allow-scripts');iframe.style.cssText=`position:absolute;left:0;top:0;border:0;width:${width}px;height:${height}px;background:transparent`;
 const page:Page={iframe,waiting:new Map(),next:0,ready:Promise.resolve()};
 page.ready=new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('The scene did not start within a minute.')),FRAME_TIMEOUT_MS);page.onReady=()=>{clearTimeout(timer);resolve();};page.onFail=error=>{clearTimeout(timer);reject(error);};});
 page.ready.catch(()=>{});iframe.src=source.url;holder.append(iframe);pages.set(key,page);return page;
}
function ask(page:Page,message:Record<string,unknown>,transfer:Transferable[]=[]):Promise<any>{
 if(page.failed)return Promise.reject(page.failed);
 const requestId=++page.next;
 return new Promise((resolve,reject)=>{
  page.waiting.set(requestId,{resolve,reject,timer:setTimeout(()=>{page.waiting.delete(requestId);reject(new Error(`Frame ${message.frame??''} was not drawn within a minute.`));},FRAME_TIMEOUT_MS)});
  page.iframe.contentWindow?.postMessage({dreamScene:true,...message,requestId},'*',transfer);
 });
}
/** Draws a frame and takes its picture as an ImageBitmap. */
async function draw(key:string,source:Source,width:number,height:number,frame:number,fps:number){
 const page=open(key,source,width,height);await page.ready;
 await ask(page,{type:'frame',frame,fps,playing:false});
 const answer=await ask(page,{type:'capture',width,height});return answer.bitmap as ImageBitmap;
}
/** An ImageBitmap's pixels as BGRA with the colour premultiplied by alpha, the desktop's picture format. */
function bgra(bitmap:ImageBitmap,width:number,height:number){
 const canvas=new OffscreenCanvas(width,height),context=canvas.getContext('2d')!;context.drawImage(bitmap,0,0,width,height);bitmap.close();
 const rgba=context.getImageData(0,0,width,height).data,out=new Uint8Array(rgba.length);
 for(let i=0;i<rgba.length;i+=4){const a=rgba[i+3];out[i]=rgba[i+2]*a/255+.5|0;out[i+1]=rgba[i+1]*a/255+.5|0;out[i+2]=rgba[i]*a/255+.5|0;out[i+3]=a;}
 return out;
}
export async function sceneFrame(request:{key:string;source:Source;width:number;height:number;frame:number;fps:number}){
 const {key,source,width,height,frame,fps}=request,bitmap=await draw(key,source,width,height,frame,fps);
 return{width,height,paint:++paints,data:bgra(bitmap,width,height),logs:[] as string[]};
}
/** One small still of a scene for the timeline, as a JPEG data URL `thumbWidth` wide; its page is closed after. */
export async function sceneStill(request:{source:Source;width:number;height:number;frame:number;fps:number},thumbWidth=240){
 const key='still:'+crypto.randomUUID();
 try{
  const bitmap=await draw(key,request.source,request.width,request.height,request.frame,request.fps),height=Math.max(1,Math.round(thumbWidth*request.height/request.width));
  const canvas=new OffscreenCanvas(thumbWidth,height);canvas.getContext('2d')!.drawImage(bitmap,0,0,thumbWidth,height);bitmap.close();
  const blob=await canvas.convertToBlob({type:'image/jpeg',quality:.8});
  return await new Promise<string>(resolve=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.readAsDataURL(blob);});
 }finally{close(key);}
}
function close(key:string){const page=pages.get(key);if(!page)return;pages.delete(key);for(const w of page.waiting.values()){clearTimeout(w.timer);w.reject(new Error('The scene was closed.'));}page.iframe.remove();}
export function closeScenes(){for(const key of[...pages.keys()])close(key);}
