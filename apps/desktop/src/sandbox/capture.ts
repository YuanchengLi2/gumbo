import type {CompiledVisual} from './compile';
import {BrowserWindow} from 'electron';
import {createHash} from 'node:crypto';
import {writeFile,mkdir} from 'node:fs/promises';
import {join} from 'node:path';
import type {Asset} from '@dream/footage';
import {VisualDefinitionSchema,type VisualDefinition} from '@dream/contracts';
import {visualAssets} from './assets';
import {visualSession,isolateWindow} from './policy';

export function testFrames(duration:number){return [0,Math.floor((duration-1)/3),Math.floor((duration-1)*2/3),duration-1];}
/** Generated JavaScript runs only inside a disposable, sandboxed Chromium renderer. */
export async function captureVisual(raw:VisualDefinition,assets:Asset[],options:{runtimeDirectory:string;directory:string;testOnly?:boolean;compiled:string|CompiledVisual;authorize?:(path:string)=>void},signal:AbortSignal,progress:(done:number,total:number)=>void=()=>{}){
 const definition=VisualDefinitionSchema.parse(raw);signal.throwIfAborted();
 const server=await visualAssets(options.runtimeDirectory,definition,options.compiled,assets,options.authorize),isolated=visualSession(server.origin);
 const window=new BrowserWindow({show:false,width:definition.width,height:definition.height,useContentSize:true,frame:false,transparent:definition.transparent,backgroundColor:definition.transparent?'#00000000':'#000000',enableLargerThanScreen:true,webPreferences:{session:isolated,nodeIntegration:false,contextIsolation:true,sandbox:true,webSecurity:true,backgroundThrottling:false,devTools:false,webgl:true,offscreen:{deviceScaleFactor:1}}});
 isolateWindow(window);window.webContents.setAudioMuted(true);window.webContents.setZoomFactor(1);
 let fatal:Error|undefined,rejectStopped!:(error:Error)=>void;
 const stopped=new Promise<never>((_resolve,reject)=>{rejectStopped=reject;});void stopped.catch(()=>{});
 const stop=(error:Error)=>{if(fatal)return;fatal=error;rejectStopped(error);if(!window.isDestroyed()){window.webContents.forcefullyCrashRenderer();window.destroy();}};
 const abort=()=>stop(new DOMException('Visual generation canceled','AbortError'));signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
 const timer=setTimeout(()=>stop(new Error('Visual rendering exceeded its processing deadline.')),10*60_000);
 async function bounded<T>(promise:Promise<T>,milliseconds=15000):Promise<T>{const timeout=setTimeout(()=>stop(new Error('The generated composition stopped responding.')),milliseconds);try{return await Promise.race([promise,stopped]);}finally{clearTimeout(timeout);}}
 try{
  await mkdir(options.directory,{recursive:true});await bounded(window.loadURL(server.url));
  const readyBy=Date.now()+15000;for(;;){signal.throwIfAborted();const state=await bounded(window.webContents.executeJavaScript('({ready:window.__dreamCapture?.ready,error:window.__dreamCapture?.error})'));if(state.error)throw new Error(state.error);if(state.ready)break;if(Date.now()>readyBy)throw new Error('The visual component did not become ready.');await new Promise(r=>setTimeout(r,25));}
  const selected=testFrames(definition.durationInFrames),frames:{frame:number;sha256:string}[]=[],stills:{frame:number;base64:string;mimeType:'image/png'}[]=[];
  const order=options.testOnly?[...new Set(selected)]:Array.from({length:definition.durationInFrames},(_,n)=>n),images=new Map<number,Buffer>();
  for(const frame of order){signal.throwIfAborted();await bounded(window.webContents.executeJavaScript(`window.__dreamCapture.seek(${frame})`));const image=await bounded(window.webContents.capturePage({x:0,y:0,width:definition.width,height:definition.height},{stayHidden:true,stayAwake:true}));const png=image.toPNG(),width=png.readUInt32BE(16),height=png.readUInt32BE(20);if(width!==definition.width||height!==definition.height)throw new Error(`Visual capture size mismatch: ${width} × ${height}.`);await writeFile(join(options.directory,`${String(frame).padStart(6,'0')}.png`),png);frames.push({frame,sha256:createHash('sha256').update(png).digest('hex')});if(selected.includes(frame))images.set(frame,png);progress(frames.length,order.length);}
  for(const frame of selected)stills.push({frame,base64:images.get(frame)!.toString('base64'),mimeType:'image/png'});
  return{frames,stills};
 }catch(error){throw fatal??error;}
 finally{clearTimeout(timer);signal.removeEventListener('abort',abort);if(!window.isDestroyed())window.destroy();await server.close();await isolated.clearStorageData();}
}
