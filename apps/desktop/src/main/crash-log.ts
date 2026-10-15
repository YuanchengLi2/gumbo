import {appendFileSync,mkdirSync,statSync,renameSync,existsSync} from 'node:fs';
import {join} from 'node:path';

/** A record of every crash, kept in <userData>/logs/crashes.log: the project service ending abnormally (with the last of
 * what it wrote to stderr), a window's renderer or a helper process going away, and errors the main process did not catch.
 * Before this a crash left nothing behind: on October 14 an agent command used up the computer's memory and the app ended
 * with no trace of why. The file is capped at 2 MB, keeping the previous one as crashes.old.log. */
let folder:string|undefined;
export function startCrashLog(userData:string){folder=join(userData,'logs');mkdirSync(folder,{recursive:true});}
export function crashLogPath(){return folder?join(folder,'crashes.log'):undefined;}
export function logCrash(kind:string,details:Record<string,unknown>){
 const file=crashLogPath();if(!file)return;
 try{
  if(existsSync(file)&&statSync(file).size>2_000_000)renameSync(file,join(folder!,'crashes.old.log'));
  appendFileSync(file,JSON.stringify({at:new Date().toISOString(),kind,...details})+'\n');
 }catch{}
}
/** The last characters a process wrote, for the record when it ends. */
export class Tail{private text='';constructor(private size=8000){}push(chunk:string){this.text=(this.text+chunk).slice(-this.size);}get value(){return this.text;}}
