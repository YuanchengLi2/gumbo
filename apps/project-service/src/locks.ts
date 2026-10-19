import {openSync,closeSync,readFileSync,writeFileSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';

/** Only the successful creator owns a lock and may remove it. */
export function acquireProjectLock(folder:string):string {
  const path=join(folder,'.dream','writer.lock');
  const create=()=>{const fd=openSync(path,'wx');try{writeFileSync(fd,JSON.stringify({pid:process.pid,started:new Date().toISOString()}));}finally{closeSync(fd);}return path;};
  try{return create();}catch(error){if((error as NodeJS.ErrnoException).code!=='EEXIST')throw error;}
  let owner:{pid:number};
  try{owner=JSON.parse(readFileSync(path,'utf8'));}catch{throw new Error('The project lock is unreadable. Restore its backup or inspect .dream/writer.lock before opening.');}
  if(!Number.isInteger(owner.pid)||owner.pid<=0)throw new Error('The project has an invalid writer lock.');
  // This service's own lock, left by its last open of the project: it is ours to take again.
  if(owner.pid===process.pid){unlinkSync(path);return create();}
  try{process.kill(owner.pid,0);}catch(error){
    if((error as NodeJS.ErrnoException).code==='ESRCH'){unlinkSync(path);return create();}
    throw new Error('Unable to verify whether another Gumbo process has this project open.');
  }
  throw new Error('This project is open in another Gumbo window.');
}
