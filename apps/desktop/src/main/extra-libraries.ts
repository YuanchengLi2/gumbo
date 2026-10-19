import {app} from 'electron';
import {spawn} from 'node:child_process';
import {existsSync,readFileSync,mkdirSync,readdirSync,renameSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {setPriority,constants} from 'node:os';

/** The Python packages the installer leaves out (slim-libraries.ts lists them in deferred.json: scipy and OpenCV, 230 MB)
 * are fetched once, a minute and a half after the app starts, into the user's data folder, where they stay across
 * updates. The agent's commands read them from there beside the bundled libraries (code-runtime.ts), and until they are
 * in place the agent is told they are still downloading (workspace-environment.ts). pip runs below normal priority and
 * installs into a scratch folder that is moved into place only when complete; a failure is retried at the next start. */
export const extraPythonFolder=(userData=app.getPath('userData'))=>join(userData,'libraries','python');

/** The deferred packages (name to version) that are not installed yet. */
export function missingPython(libraries:string,folder=extraPythonFolder()):Record<string,string>{
 let deferred:Record<string,string>={};
 try{deferred=JSON.parse(readFileSync(join(libraries,'deferred.json'),'utf8')).python??{};}catch{return{};}
 return Object.fromEntries(Object.entries(deferred).filter(([name,version])=>!existsSync(join(folder,`${name.replace(/-/g,'_')}-${version}.dist-info`))));
}

let running:Promise<boolean>|undefined;
export function fetchExtraLibraries(paths:{creation:string;libraries:string},options:{delayMs?:number;folder?:string;python?:string}={}){
 const folder=options.folder??extraPythonFolder(),missing=missingPython(paths.libraries,folder);
 if(!Object.keys(missing).length)return Promise.resolve(true);
 return running??=new Promise<boolean>(resolve=>{
  const timer=setTimeout(()=>{
   const scratch=folder+'.partial';rmSync(scratch,{recursive:true,force:true});mkdirSync(scratch,{recursive:true});
   const python=options.python??join(paths.creation,'python','python.exe');
   const args=['-m','pip','install','--target',scratch,'--no-deps','--only-binary=:all:','--no-input','--disable-pip-version-check','--no-cache-dir',...Object.entries(missing).map(([name,version])=>`${name}==${version}`)];
   const env:NodeJS.ProcessEnv={NODE_ENV:'production',SystemRoot:process.env.SystemRoot??'C:\\Windows',PYTHONHOME:join(paths.creation,'python'),PYTHONNOUSERSITE:'1',PATH:process.env.PATH??''};
   const child=spawn(python,args,{windowsHide:true,env});
   if(child.pid)try{setPriority(child.pid,constants.priority.PRIORITY_BELOW_NORMAL);}catch{}
   let log='';child.stdout.on('data',(d:Buffer)=>{log=(log+d).slice(-4000);});child.stderr.on('data',(d:Buffer)=>{log=(log+d).slice(-4000);});
   const done=(ok:boolean)=>{running=undefined;if(!ok){console.error('Fetching the Python libraries failed:',log.trim().slice(-1500));rmSync(scratch,{recursive:true,force:true});}resolve(ok);};
   child.once('error',()=>done(false));
   child.once('exit',code=>{
    if(code!==0)return done(false);
    try{mkdirSync(folder,{recursive:true});for(const name of readdirSync(scratch)){rmSync(join(folder,name),{recursive:true,force:true});if(/\.whl$/i.test(name))continue;renameSync(join(scratch,name),join(folder,name));}rmSync(scratch,{recursive:true,force:true});done(Object.keys(missingPython(paths.libraries,folder)).length===0);}
    catch(error){log+=String(error);done(false);}
   });
  },options.delayMs??90_000);timer.unref?.();
 });
}
