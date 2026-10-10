import {BrowserWindow,session} from 'electron';
import {readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {dirname,relative,join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {workspacePath} from '../../../../packages/project-db/src/workspace-store';

const RenderSchema=z.object({entry:z.string(),output:z.string().startsWith('output/'),width:z.number().int().min(16).max(3840),height:z.number().int().min(16).max(3840),fps:z.number().int().min(1).max(60),frames:z.number().int().min(1).max(36000)});
/** Render already-bundled HTML/JS. Chromium remains sandboxed; there is no import catalogue. */
export async function renderWorkspace(root:string,raw:unknown,signal:AbortSignal,progress:(text:string)=>void){
 const spec=RenderSchema.parse(raw),entry=workspacePath(root,spec.entry),output=workspacePath(root,spec.output),sources=join(dirname(root),'Sources');mkdirSync(output,{recursive:true});
 const partition='dream-code-render-'+randomUUID(),ses=session.fromPartition(partition,{cache:false});
 ses.on('will-download',event=>event.preventDefault());
 ses.setPermissionRequestHandler((_web,_permission,reply)=>reply(false));ses.setPermissionCheckHandler(()=>false);
 ses.webRequest.onBeforeRequest((details,reply)=>{try{const url=new URL(details.url);if(['data:','blob:','about:'].includes(url.protocol)){reply({cancel:false});return;}if(url.protocol==='file:'){const path=fileURLToPath(url);try{workspacePath(root,relative(root,path));reply({cancel:false});return;}catch{}try{workspacePath(sources,relative(sources,path));reply({cancel:false});return;}catch{}const media=join(dirname(root),'Media');workspacePath(media,relative(media,path));reply({cancel:false});return;}}catch{}reply({cancel:true});});
 const window=new BrowserWindow({show:false,transparent:true,backgroundColor:'#00000000',width:spec.width,height:spec.height,useContentSize:true,webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false,webSecurity:true,backgroundThrottling:false,partition}});
 window.webContents.setWindowOpenHandler(()=>({action:'deny'}));const cancel=()=>{if(!window.isDestroyed())window.destroy();};signal.addEventListener('abort',cancel,{once:true});
 try{
  signal.throwIfAborted();await window.loadURL(pathToFileURL(entry).href);await window.webContents.executeJavaScript('document.fonts.ready.then(()=>true)');
  for(let frame=0;frame<spec.frames;frame++){
   signal.throwIfAborted();await window.webContents.executeJavaScript(`Promise.resolve(typeof window.renderFrame==='function'?window.renderFrame(${frame},${spec.fps}):null).then(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))))`);
   const image=await window.webContents.capturePage({x:0,y:0,width:spec.width,height:spec.height},{stayHidden:true,stayAwake:true});writeFileSync(workspacePath(root,spec.output+'/'+String(frame).padStart(6,'0')+'.png'),image.toPNG());if(frame%spec.fps===0||frame===spec.frames-1)progress(`Rendering ${frame+1}/${spec.frames} frames\n`);
  }
  return{output:spec.output,frames:spec.frames,fps:spec.fps,width:spec.width,height:spec.height};
 }finally{signal.removeEventListener('abort',cancel);if(!window.isDestroyed())window.destroy();ses.webRequest.onBeforeRequest(null);await ses.clearStorageData();}
}
