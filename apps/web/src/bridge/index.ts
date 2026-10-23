import {scoreCatalog,sfxCatalog} from '@dream/procedural-media';
import type {AppSettings} from '@dream/contracts';
import {Account} from './account';
import {onEvent,publish} from './events';
import {loadSettings,saveSettings} from './settings';
import {ProjectClient} from './project';
import {pickFiles,pickFolder,store} from './imports';
import * as exporting from './export';
import {serveScenes} from './engine';
import * as scenes from './scenes';
import {keepStorage} from './awake';

/** window.dream in the browser: what the desktop app's preload and main process answer (preload/index.ts, main/index.ts),
 * answered here. Projects, import and editing run in the project worker (the desktop's project service, unchanged);
 * export draws in the editor and is saved here (export.ts); Roux and the computer's folders arrive in later phases and
 * say so until then. */
export const account=new Account();
const notYet=(what:string)=>()=>Promise.reject(new Error(`${what} is not available on the web yet.`));
const version='0.3.0';
// The settings the project service reads with every request (main/app-settings.ts settingsEnv).
const settingsEnv=(s:AppSettings)=>({DREAM_CREATOR_PROFILE:JSON.stringify(s.profile),DREAM_DISABLED_PROVIDERS:s.disabledProviders.join(',')});
let projects:ProjectClient|undefined;
const service=()=>projects??=new ProjectClient(account,settingsEnv(loadSettings()));
let openProject=false;

/** The account requests the editor sends as commands ({type:'account',action}), as main/index.ts answers them. */
async function accountCommand(c:{action?:string;query?:string;profile?:unknown;plan?:string;packs?:number;flow?:string;turnId?:string;note?:string;kind?:'report'|'feedback'|'training';rating?:'up'|'down'}){
 switch(c.action){
  case 'browser':{const url=await account.beginSignIn();setTimeout(()=>location.assign(url),50);return{started:true,url};}
  case 'signout':return account.signout();
  case 'usage':return account.usage();
  case 'billing':return account.billing();
  case 'activity':return account.activity();
  case 'creators':return account.creators(c.query??'');
  case 'profile':return account.profile(c.profile);
  case 'checkout':case 'portal':{const url=await account.payPage(c.action,{plan:c.plan,packs:c.packs,flow:c.flow});window.open(url,'_blank','noopener');return{opened:true};}
  case 'report':{const log=c.turnId?await service().command({type:'turn_log',turnId:c.turnId}).catch(()=>null):null;return account.report({turnId:c.turnId??'',note:c.note??'',kind:c.kind??'report',...(c.rating?{rating:c.rating}:{}),appVersion:version,platform:`web ${navigator.platform}`,log});}
  default:return account.info();
 }
}
async function command(c:any){
 if(c?.type==='account')return accountCommand(c);
 // Before a project is open, the providers come from the account (main/index.ts does the same).
 if(c?.type==='ai_providers'&&!openProject){const off=new Set(loadSettings().disabledProviders as string[]);return{...Object.fromEntries(Object.entries(await account.providers()).filter(([p,on])=>on===true&&!off.has(p))),anthropic:true};}
 const result=await service().command(c);if(result?.meta)openProject=true;return result;
}

export function createBridge(){
 const base=import.meta.env.BASE_URL;
 service();serveScenes(service);void keepStorage();
 return {
  web:true,
  // The service worker's routes for what the desktop serves from dream-media:// and dream-engine:// (sw.js).
  routes:{media:`${base}media/`,engine:`${base}engine/`},
  setTheme:async(_theme:'light'|'dark',color?:string)=>{if(color)document.documentElement.style.background=color;},
  projects:()=>service().host('list'),
  projectAction:(id:string,action:string)=>service().host('action',{id,action}),
  createProject:async(request:any)=>{const location=await service().host('allocate',{request});const state=await service().command({type:'create',...location,initialRequest:request});openProject=true;return state;},
  // The computer's files are the folders the user grants (project/files.ts): allowing access means choosing a folder.
  fileGrants:()=>service().host('fileGrants'),
  grantComputer:async()=>{const path=await pickFolder('gumbo-files');return path?service().host('grantFolder',{path}):null;},
  revokeFileGrant:(id:string)=>service().host('revokeGrant',{id}),cancelFiles:(id:string)=>service().host('cancelFiles',{id}),
  files:(request:unknown)=>service().host('files',{request}),
  // A decision on proposed changes resumes the run that waits for it (main/index.ts dream:decideFileChange).
  decideFileChange:async(id:string,approve:boolean)=>{const proposal=await service().host<{projectId?:string}>('decideFile',{id,approve}),state=await service().command({type:'state'}).catch(()=>null);
   if(state?.meta?.id===proposal.projectId&&state?.aiStatus==='awaiting_file_permission')await service().command({type:'resume'});return proposal;},
  registerDropped:(files:File[])=>store(files),
  command,
  // Projects live in this browser: there is no folder to open; the home screen's list opens them.
  pickProject:async()=>null,pickMedia:()=>pickFiles(),mediaPath:(file:File)=>file.name,
  exportVideo:notYet('Exporting for other editors'),pickExportFolder:()=>exporting.pickExportFolder(),
  beginExport:async(settings:unknown)=>exporting.beginExport(settings,await service().command({type:'state'})),exportChunk:exporting.exportChunk,
  // Scene pictures: each scene draws itself in a hidden page (scenes.ts); its page gets its files from engine.ts.
  sceneFrame:(request:any)=>scenes.sceneFrame(request),closeScenes:async()=>scenes.closeScenes(),
  setFullScreen:async(on:boolean)=>{if(on&&!document.fullscreenElement)await document.documentElement.requestFullscreen().catch(()=>{});else if(!on&&document.fullscreenElement)await document.exitFullscreen().catch(()=>{});},
  settings:async()=>loadSettings(),saveSettings:async(patch:unknown)=>{const next=saveSettings(patch);service().config({settings:settingsEnv(next)});return next;},
  openFolder:async()=>undefined,framesResult:async(id:string,result:unknown)=>service().framesResult(id,result),sceneStill:(request:any)=>scenes.sceneStill(request),
  finishExport:exporting.finishExport,failExport:async(id:string,message:string)=>exporting.failExport(id,message),cancelExport:async()=>exporting.cancelExport(),
  reveal:(path:string)=>exporting.reveal(path),shareExport:notYet('Sharing'),
  // Browsers driven by tests skip the welcome questions, as the desktop's headless runs do.
  runtime:async()=>({...(navigator.webdriver?{automated:true}:{}),web:true,ffmpeg:true,ffprobe:true,python:false,whisper:false,models:false,platform:'web',memoryGb:(navigator as any).deviceMemory??8,version,projectsFolder:'This browser',logsFolder:''}),
  // The site always serves the newest version: nothing to update or restart into.
  update:async()=>({available:false}),restartToUpdate:async()=>location.reload(),
  catalog:async()=>({scores:scoreCatalog,sfx:sfxCatalog}),
  onEvent,
 };
}

/** Finishes a sign-in this page came back from, and tells the editor (the event the desktop sends after its callback). */
export async function finishPendingSignIn(){
 try{if(await account.finishSignIn())publish('account.signed_in',await account.info());}
 catch(error){publish('account.error',{message:(error as Error).message});}
}
