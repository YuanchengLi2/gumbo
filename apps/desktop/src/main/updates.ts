import {app,autoUpdater} from 'electron';
import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import type {UpdateStatus} from '@dream/contracts';

/** Updates on Windows through Squirrel, the installer Gumbo ships with. A minute after it starts, and every four hours,
 * the installed app asks the release feed (the folder holding RELEASES and the .nupkg packages) for a newer version and
 * downloads it in the background. Once it is ready the profile menu offers "Restart to update"; otherwise the new version
 * simply starts the next time Gumbo opens. Only packaged Windows builds with a feed check: during the first run after an
 * install Squirrel still holds its lock, so that run does not. Failed checks stay quiet and are tried again later. */
type Updater=Pick<typeof autoUpdater,'setFeedURL'|'checkForUpdates'|'quitAndInstall'|'on'>;
type Options={feed?:string;updater?:Updater;packaged?:boolean;platform?:string;argv?:string[];firstCheckMs?:number;everyMs?:number};

/** The release feed: DREAM_UPDATE_URL, or `updates` in the staged cloud.json the package was built with. */
export function updateFeed(env:Record<string,string|undefined>=process.env,cloud=join(process.resourcesPath??app.getAppPath(),'staged/cloud.json')){
 if(env.DREAM_UPDATE_URL)return env.DREAM_UPDATE_URL;
 try{const value=existsSync(cloud)?JSON.parse(readFileSync(cloud,'utf8')).updates:undefined;return typeof value==='string'&&/^https:\/\//.test(value)?value:undefined;}catch{return undefined;}
}

export function startUpdates(publish:(status:UpdateStatus)=>void,options:Options={}){
 const feed=options.feed??updateFeed(),updater=options.updater??autoUpdater,argv=options.argv??process.argv;
 if(!(options.packaged??app.isPackaged)||(options.platform??process.platform)!=='win32'||!feed||argv.includes('--squirrel-firstrun'))return undefined;
 let status:UpdateStatus={status:'idle'};
 const set=(next:UpdateStatus)=>{status=next;publish(next);};
 updater.setFeedURL({url:feed});
 updater.on('update-available',()=>{if(status.status!=='ready')set({status:'downloading'});});
 updater.on('update-not-available',()=>{if(status.status!=='ready')set({status:'idle'});});
 updater.on('update-downloaded',(_event:unknown,_notes:unknown,name:unknown)=>set({status:'ready',...(typeof name==='string'&&name?{version:name}:{})}));
 updater.on('error',(error:Error)=>{console.error('Update check failed:',error?.message);if(status.status!=='ready')set({status:'idle'});});
 // A check while one is downloading, or once one is ready, would only download it again.
 const check=()=>{if(status.status!=='idle')return;try{updater.checkForUpdates();}catch(error){console.error('Update check failed:',(error as Error).message);}};
 const first=setTimeout(check,options.firstCheckMs??60_000),every=setInterval(check,options.everyMs??4*3_600_000);first.unref?.();every.unref?.();
 return{status:()=>status,check,
  /** Restarts into the downloaded version; false when none is ready. */
  restart:()=>{if(status.status!=='ready')return false;updater.quitAndInstall();return true;},
  stop:()=>{clearTimeout(first);clearInterval(every);}};
}
