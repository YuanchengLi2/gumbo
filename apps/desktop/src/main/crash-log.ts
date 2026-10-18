import {appendFileSync,mkdirSync,statSync,renameSync,existsSync,readFileSync,writeFileSync,rmSync,readdirSync} from 'node:fs';
import {join} from 'node:path';

/** A record of every crash, kept in <userData>/logs/crashes.log: the project service ending abnormally (with the last of
 * what it wrote to stderr), a window's renderer or a helper process going away, and errors the main process did not catch.
 * Before this a crash left nothing behind: on October 14 an agent command used up the computer's memory and the app ended
 * with no trace of why. The file is capped at 2 MB, keeping the previous one as crashes.old.log. */
let folder:string|undefined;
export function startCrashLog(userData:string){folder=join(userData,'logs');mkdirSync(folder,{recursive:true});}
export function crashLogPath(){return folder?join(folder,'crashes.log'):undefined;}
export function logCrash(kind:string,details:Record<string,unknown>){append('crashes',{kind,...details});}
/** Each export's timing, in <userData>/logs/exports.log: how long it took and where the time went (decoding, scenes,
 * encoding, adding the sound), so a slow export says why. The same 2 MB cap, keeping exports.old.log. */
export function logExport(details:Record<string,unknown>){append('exports',details);}
function append(name:string,record:Record<string,unknown>){
 if(!folder)return;const file=join(folder,name+'.log');
 try{
  if(existsSync(file)&&statSync(file).size>2_000_000)renameSync(file,join(folder,name+'.old.log'));
  appendFileSync(file,JSON.stringify({at:new Date().toISOString(),...record})+'\n');
 }catch{}
}
/** The last characters a process wrote, for the record when it ends. */
export class Tail{private text='';constructor(private size=8000){}push(chunk:string){this.text=(this.text+chunk).slice(-this.size);}get value(){return this.text;}}

/** Whether the last run ended without quitting. A crash in the main process runs no JavaScript, so it leaves no record of
 * its own (on October 17 the app closed during an edit with exit code 0xCFFFFFFF and nothing in this log). A marker is
 * written at start and removed on a normal quit; when the next start finds it, that run crashed or was killed, and the
 * record says when it started and names the newest crash dump Electron's crash reporter kept on this computer. */
export function markRunning(dumps:string){
 if(!folder)return;const marker=join(folder,'running.json');
 try{
  if(existsSync(marker)){const last=JSON.parse(readFileSync(marker,'utf8')) as {pid?:number;startedAt?:string};
   logCrash('previous-run-ended-unexpectedly',{pid:last.pid,startedAt:last.startedAt,dump:newestDump(dumps,Date.parse(last.startedAt??'')||0)});}
  writeFileSync(marker,JSON.stringify({pid:process.pid,startedAt:new Date().toISOString()}));
 }catch{}
}
export function markQuit(){if(folder)try{rmSync(join(folder,'running.json'),{force:true});}catch{}}
function newestDump(folder:string,since:number){
 let best:{path:string;at:number}|undefined;
 const walk=(dir:string,depth:number)=>{if(depth>3||!existsSync(dir))return;for(const entry of readdirSync(dir,{withFileTypes:true})){const path=join(dir,entry.name);
  if(entry.isDirectory())walk(path,depth+1);else if(entry.name.endsWith('.dmp')){const at=statSync(path).mtimeMs;if(at>=since&&(!best||at>best.at))best={path,at};}}};
 try{walk(folder,0);}catch{}return best?.path;
}
