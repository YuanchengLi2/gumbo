/// <reference lib="webworker" />
import {deliver} from './globals';
import type {Asset} from '@dream/footage';
import {connectFs,mkdirSync,existsSync,rmSync} from './fs/sync-fs';
import {initSqlite} from './shims/better-sqlite3';
import {connectPrograms} from './shims/child-process';
import {startHost,host,hostUpdate,trackAssets,trackDraft} from './host';
import {startFiles,files} from './files';
import {connectionAnswer} from './connection';
import {runCode,cancelCode} from './commands';
import {syncRoutes} from './routes';

/** The project worker: Gumbo's project service (apps/project-service/src/main.ts, unchanged) in the browser. It starts
 * the storage worker (synchronous files over OPFS) and the media worker (ffmpeg and ffprobe's commands), opens SQLite,
 * then loads the service. Messages: {boot:{env}} first; {host:{id,action,args}} for the project list and the computer's
 * files; anything else is the service's own protocol (commands, connection answers), as the desktop's utility process
 * receives it. What the service asks about the computer's files is answered here (files.ts), and its commands run in
 * the browser sandbox from here (commands.ts), not by the page. */
const post=(message:unknown)=>(self as unknown as Worker).postMessage(message);
let booted:Promise<void>|undefined,openFolder:string|undefined,openId:string|undefined;
const fileRequests=new Map<string,AbortController>();
/** One project service per browser: SQLite's files open in one place only. The lock lives as long as this worker, so a
 * reloaded page's new worker waits for the old one to stop, and a second tab waits until the first closes. */
function exclusive(){
 return new Promise<void>(resolve=>{
  const hold=()=>{resolve();return new Promise<never>(()=>{});};
  void navigator.locks.request('gumbo-project-service',{ifAvailable:true},lock=>{if(lock)return hold();post({waiting:'another-tab'});void navigator.locks.request('gumbo-project-service',hold);return undefined;});
 });
}
/** Footage dropped or picked waits in /imports (bridge/imports.ts) until it is imported; once the project holds its own
 * copy, the waiting one is removed, so the browser's storage keeps the footage once. */
function releaseStaged(assets:Asset[]){
 for(const asset of assets){const from=asset.source?.path;if(!from?.startsWith('/imports/')||asset.originalPath===from)continue;const folder=from.slice(0,from.lastIndexOf('/'));if(existsSync(folder))rmSync(folder,{recursive:true,force:true});}
}
/** The service's question about the computer's files (main/service.ts file), answered as the desktop's main does. */
async function answerFile(data:{id:string;request:any;context:any}){
 const controller=new AbortController();fileRequests.set(data.id,controller);
 try{deliver({fileResult:{id:data.id,result:await files.request(data.request,data.context,controller.signal)}});}
 catch(error){deliver({fileResult:{id:data.id,error:(error as Error).message}});}
 finally{fileRequests.delete(data.id);}
}
async function boot(env:Record<string,string>){
 await exclusive();
 Object.assign(process.env,{DREAM_RUNTIME:'browser',DREAM_FFMPEG:'ffmpeg',DREAM_FFPROBE:'ffprobe',DREAM_INGEST_BINARY:'',DREAM_WHISPER_BINARY:'',DREAM_WHISPER_MODEL:'',...env});
 await connectFs(new Worker(new URL('./fs/storage.worker.ts',import.meta.url),{type:'module'}));
 // Two media workers: a look at a few frames runs beside a long analysis instead of after it.
 connectPrograms(...[0,1].map(()=>new Worker(new URL('./media/media.worker.ts',import.meta.url),{type:'module'})));
 await initSqlite();
 for(const folder of ['/tmp','/profile','/Dream/Projects'])mkdirSync(folder,{recursive:true});
 startFiles();startHost();
 const send=(process as any).parentPort.postMessage.bind((process as any).parentPort);
 // States it reports also refresh the project list and the service worker's media routes (routes.ts), before they leave:
 // the editor asks for the media as soon as it sees them. Messages keep their order (state deltas are numbered).
 let outgoing=Promise.resolve();
 // The project list (its name, length and picture on the home screen): written at once for a project's first state, so
 // a new project is listed even if the page closes right away, then at most every two seconds with the latest state
 // following a moment later. Writing it before every state held each edit up by its file writes.
 let listed:any,listTimer:ReturnType<typeof setTimeout>|undefined,listedId:string|undefined,listedAt=0;
 const listNow=(state:any)=>{clearTimeout(listTimer);listTimer=undefined;listedId=state.meta.id;listedAt=Date.now();hostUpdate(state);};
 const listLater=(state:any)=>{listed=state;if(state.meta.id!==listedId||Date.now()-listedAt>2000){listNow(state);return;}
  if(!listTimer)listTimer=setTimeout(()=>listNow(listed),400);};
 (process as any).parentPort.postMessage=(message:any)=>{
  const state=message?.result?.timeline?message.result:message?.event?.type==='state'?message.event.payload:undefined;if(state?.meta){openFolder=state.meta.folder;openId=state.meta.id;listLater(state);}
  if(message?.file){void answerFile(message.file);return;}
  if(message?.fileCancel){fileRequests.get(message.fileCancel)?.abort();return;}
  if(message?.codeRun){void runCode(message.codeRun,{folder:openFolder,id:openId},deliver);return;}
  if(message?.codeCancel){cancelCode(message.codeCancel);return;}
  const footage=state?.footage??(message?.event?.type==='state.delta'?message.event.payload?.changes?.footage:undefined);
  if(footage?.assets){releaseStaged(footage.assets);trackAssets(footage.assets);}
  // A draft scene is kept here for its page, as the desktop's main keeps it; the editor does not get the event.
  if(message?.event?.type==='scene.draft'){trackDraft(message.event.payload);return;}
  outgoing=outgoing.then(async()=>{if(footage?.assets)await syncRoutes(footage.assets);send(message);});};
 await import('../../../project-service/src/main');
}
self.onmessage=async(event:MessageEvent)=>{
 const data=event.data;
 if(data?.boot){booted??=boot(data.boot.env??{});try{await booted;post({booted:true});}catch(error){post({bootError:String((error as Error)?.stack??error)});}return;}
 await booted;
 if(data?.host){const {id,action,args}=data.host;try{post({hostResult:{id,result:await host(action,args,{folder:openFolder,id:openId})}});}catch(error){post({hostResult:{id,error:(error as Error).message}});}return;}
 if(connectionAnswer(data))return;
 deliver(data);
};
