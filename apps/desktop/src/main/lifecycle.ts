import {app} from 'electron';
import {spawn} from 'node:child_process';
import {basename,dirname,resolve} from 'node:path';

export function handleInstallerEvent(){
 if(process.platform!=='win32')return false;
 const event=process.argv[1];
 if(!['--squirrel-install','--squirrel-updated','--squirrel-uninstall','--squirrel-obsolete'].includes(event))return false;
 if(event==='--squirrel-obsolete'){setTimeout(()=>app.quit(),0);return true;}
 const update=resolve(dirname(process.execPath),'..','Update.exe');
 const command=event==='--squirrel-uninstall'?'--removeShortcut':'--createShortcut';
 const child=spawn(update,[command,basename(process.execPath)],{windowsHide:true});
 const timeout=setTimeout(()=>{child.kill();app.quit();},15000);
 const done=()=>{clearTimeout(timeout);app.quit();};child.once('error',done);child.once('exit',done);
 return true;
}
