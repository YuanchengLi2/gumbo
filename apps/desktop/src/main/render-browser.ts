import {app} from 'electron';
import {spawn} from 'node:child_process';
import {createRequire} from 'node:module';
import {existsSync,mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';

/** The headless Chrome that renders scenes for an editable-timeline export (timeline-export.ts). The installer leaves it
 * out: it was 282 MB of the installed app and 115 MB of the download for an export few people use. The first such export
 * downloads it once into the user's data folder, where it stays across updates. Remotion's ensureBrowser downloads into
 * the node_modules/.remotion of the nearest package.json above the current folder, so it runs as a Node process (the
 * app's own executable with ELECTRON_RUN_AS_NODE) started in a folder of Gumbo's that has one. */
let pending:Promise<string>|undefined;
export function renderBrowser(bundled:string,onDownload?:()=>void):Promise<string>{
 if(existsSync(bundled))return Promise.resolve(bundled);
 return pending??=download(onDownload).finally(()=>{pending=undefined;});
}

function download(onDownload?:()=>void){
 const folder=join(app.getPath('userData'),'render-browser');mkdirSync(folder,{recursive:true});
 const marker=join(folder,'package.json');if(!existsSync(marker))writeFileSync(marker,'{"private":true}');
 const renderer=createRequire(__filename).resolve('@remotion/renderer');
 const script=`require(${JSON.stringify(renderer)}).ensureBrowser({chromeMode:'headless-shell',logLevel:'error'}).then(s=>process.stdout.write(JSON.stringify(s)),e=>{process.stderr.write(String(e&&e.message||e));process.exit(1);});`;
 return new Promise<string>((resolve,reject)=>{
  onDownload?.();
  const child=spawn(process.execPath,['-e',script],{cwd:folder,env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},windowsHide:true});
  let out='',err='';child.stdout.on('data',d=>{out+=d;});child.stderr.on('data',d=>{err+=d;});
  child.once('error',reject);
  child.once('exit',code=>{
   try{const status=JSON.parse(out) as {path?:string};if(code===0&&status.path&&existsSync(status.path))return resolve(status.path);}catch{}
   reject(new Error('Could not download the export renderer'+(err.trim()?`: ${err.trim().slice(0,300)}`:'. Check the internet connection and try again.')));
  });
 });
}
