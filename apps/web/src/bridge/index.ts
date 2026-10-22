import {scoreCatalog,sfxCatalog} from '@dream/procedural-media';
import {Account} from './account';
import {onEvent,publish} from './events';
import {loadSettings,saveSettings} from './settings';

/** window.dream in the browser: what the desktop app's preload and main process answer (preload/index.ts, main/index.ts),
 * answered here. Projects, import, Roux and export arrive in the next phases (the project worker, the media worker);
 * until then those calls say plainly that they are not on the web yet. */
export const account=new Account();
const notYet=(what:string)=>()=>Promise.reject(new Error(`${what} is not available on the web yet.`));
const version='0.3.0';

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
  case 'report':return account.report({turnId:c.turnId??'',note:c.note??'',kind:c.kind??'report',...(c.rating?{rating:c.rating}:{}),appVersion:version,platform:`web ${navigator.platform}`,log:null});
  default:return account.info();
 }
}

async function command(c:any){
 if(c?.type==='account')return accountCommand(c);
 if(c?.type==='ai_providers'){const off=new Set(loadSettings().disabledProviders as string[]);return{...Object.fromEntries(Object.entries(await account.providers()).filter(([p,on])=>on===true&&!off.has(p))),anthropic:true};}
 throw new Error(`"${c?.type}" is not available on the web yet.`);
}

export function createBridge(){
 const base=import.meta.env.BASE_URL;
 return {
  web:true,
  // The service worker's routes for what the desktop serves from dream-media:// and dream-engine:// (sw.js).
  routes:{media:`${base}media/`,engine:`${base}engine/`},
  setTheme:async(_theme:'light'|'dark',color?:string)=>{if(color)document.documentElement.style.background=color;},
  projects:async()=>[],
  projectAction:notYet('Managing projects'),createProject:notYet('Creating projects'),
  fileGrants:async()=>[],grantComputer:notYet('Opening a folder'),revokeFileGrant:async()=>undefined,cancelFiles:async()=>undefined,
  files:notYet('Browsing files'),decideFileChange:notYet('File changes'),registerDropped:notYet('Dropping files'),
  command,
  pickProject:notYet('Opening projects'),pickMedia:notYet('Importing media'),mediaPath:(file:File)=>file.name,
  exportVideo:notYet('Export'),pickExportFolder:notYet('Export'),beginExport:notYet('Export'),exportChunk:notYet('Export'),
  sceneFrame:notYet('Scene frames'),closeScenes:async()=>undefined,
  setFullScreen:async(on:boolean)=>{if(on&&!document.fullscreenElement)await document.documentElement.requestFullscreen().catch(()=>{});else if(!on&&document.fullscreenElement)await document.exitFullscreen().catch(()=>{});},
  settings:async()=>loadSettings(),saveSettings:async(patch:unknown)=>saveSettings(patch),
  openFolder:async()=>undefined,framesResult:async()=>undefined,sceneStill:notYet('Scene stills'),
  finishExport:notYet('Export'),failExport:async()=>undefined,cancelExport:async()=>undefined,reveal:async()=>undefined,shareExport:notYet('Sharing'),
  runtime:async()=>({web:true,ffmpeg:true,ffprobe:true,python:false,whisper:false,models:false,platform:'web',memoryGb:(navigator as any).deviceMemory??8,version,projectsFolder:'This browser',logsFolder:''}),
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
