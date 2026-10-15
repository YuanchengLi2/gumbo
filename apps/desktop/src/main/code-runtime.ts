import {spawn} from 'node:child_process';
import {existsSync,readFileSync,mkdirSync,appendFileSync,writeFileSync,readdirSync,renameSync} from 'node:fs';
import {join,resolve,dirname,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {totalmem} from 'node:os';
import {ProcessRequestSchema,type ProcessRequest,type ProcessResult} from '@dream/contracts';
import {workspacePath} from '../../../../packages/project-db/src/workspace-store';

const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
/** Unix tools for programs that start their own shell: Python's os.system, Node's exec and npm scripts get cmd.exe on
 * Windows, where head, grep or sed did not exist ("'head' is not recognized"). Each is a one-line .cmd that runs BusyBox's
 * tool, placed last on PATH so the computer's own programs of the same name still win. */
export const unixTools=['awk','basename','cat','cut','diff','dirname','du','env','expr','find','grep','gunzip','gzip','head','ls','md5sum','mkdir','mktemp','mv','cp','printf','readlink','realpath','rm','sed','seq','sh','sha256sum','sleep','sort','stat','tail','tar','tee','touch','tr','uniq','unzip','wc','wget','which','xargs'];
export function unixToolShims(folder:string,busybox:string){
 const marker=join(folder,'.busybox');if(existsSync(marker)&&readFileSync(marker,'utf8')===busybox)return folder;
 mkdirSync(folder,{recursive:true});for(const tool of unixTools)writeFileSync(join(folder,tool+'.cmd'),`@"${busybox}" ${tool} %*\r\n`);writeFileSync(marker,busybox);return folder;
}
/** The most memory one command (with every program it starts) may use: 60% of the computer's memory, leaving at least 3 GB
 * for the app and everything else, and never under 2 GB. A command that needs more fails with a note saying so, instead of
 * using up the computer's memory and taking the app down with it (a filter graph over a 21-minute 1080p source did, October
 * 14). DREAM_COMMAND_MEMORY_GB overrides it. */
export function commandMemoryLimit(total=totalmem()){
 const gb=1024**3,set=Number(process.env.DREAM_COMMAND_MEMORY_GB);if(set>0)return Math.round(set*gb);
 return Math.round(Math.max(2*gb,Math.min(total*.6,total-3*gb)));
}
// The app's own secrets never reach a command run on the user's computer.
const secret=/^(?:DREAM_|SUPABASE|ANTHROPIC|OPENAI|GROQ|ELECTRON_|NODE_OPTIONS$)|(?:TOKEN|SECRET|PASSWORD|API_?KEY)/i;
export class CodeRuntime {
 private owned=new Set<AbortController>();
 /** When it returns true (the user allowed computer access), commands run on the user's computer like a terminal: their
  * programs, their files and the internet, with the bundled Node, Python and ffmpeg added to PATH. Otherwise they run in
  * the isolated creation container. */
 local?:()=>boolean;
 constructor(private paths:{creation:string;ffmpeg:string;ffprobe:string;browser:string},private qualification=false){}
 check(){
  if(process.platform!=='win32')throw new Error('Automatic creation is not yet qualified on this platform.');
  const path=join(this.paths.creation,'manifest.json');if(!existsSync(path))throw new Error('The bundled creation environment is missing. Stage the pinned runtimes.');
  if(!this.qualification){const file=join(this.paths.creation,'qualification.json');if(!existsSync(file))throw new Error('The creation environment has not passed its native qualification.');const result=JSON.parse(readFileSync(file,'utf8'));if(result.manifestHash!==hash(readFileSync(path))||result.passed!==true)throw new Error('The creation environment changed and needs native qualification.');}
 }
 async run(raw:ProcessRequest,signal:AbortSignal,onOutput:(text:string)=>void):Promise<ProcessResult>{
  // A command on the user's computer needs no container, so the container's checks apply only to it.
  const local=!!this.local?.();if(!local)this.check();const request=ProcessRequestSchema.parse(raw);signal.throwIfAborted();const root=resolve(request.workspace),cwd=workspacePath(root,request.cwd),project=dirname(root),recordRoot=join(project,'.dream','processes');
  if(relative(project,root)!=='Workspace')throw new Error('Invalid project workspace.');mkdirSync(recordRoot,{recursive:true});
  const commandHash=hash(JSON.stringify({command:request.command,cwd:request.cwd})),receiptPath=join(recordRoot,request.id+'.json'),intentPath=join(recordRoot,request.id+'.intent.json'),logPath=join(recordRoot,request.id+'.log');
  if(existsSync(receiptPath)){const saved=JSON.parse(readFileSync(receiptPath,'utf8'));if(saved.commandHash!==commandHash)throw new Error('Process identity mismatch.');return{...saved,logPath};}
  if(existsSync(intentPath))throw new Error('This process was interrupted without a terminal receipt. Inspect its log and outputs before issuing a new command.');
  const manifest=local?{files:{}}:JSON.parse(readFileSync(join(this.paths.creation,'manifest.json'),'utf8'));
  if(!local)for(const file of ['host/creation-host.exe','node/node.exe','python/python.exe','shell/busybox.exe'])if(hash(readFileSync(join(this.paths.creation,file)))!==manifest.files[file])throw new Error('Bundled creation runtime integrity check failed.');
  // Commands run in BusyBox's POSIX sh, so they quote like a terminal and have head, grep, sed, awk and find built in.
  const shell=join(this.paths.creation,'shell','busybox.exe');if(!existsSync(shell))throw new Error('The bundled command shell is missing. Stage the pinned runtimes.');
  // Inside the container BusyBox cannot hand itself over to a program, so a command's last line is never exec'd: the
  // shell stays, waits for it and passes on its exit code.
  const script=request.command+'\nexit $?';
  const libraries=join(dirname(this.paths.creation),'libraries'),shared=existsSync(join(libraries,'libraries.json'));
  const cache=join(root,'.cache'),sources=join(project,'Sources');mkdirSync(cache,{recursive:true});mkdirSync(sources,{recursive:true});mkdirSync(join(project,'Media'),{recursive:true});
  const longPath=(path:string)=>path.startsWith('\\\\?\\')?path:'\\\\?\\'+path;
  const systemRoot=process.env.SystemRoot??'C:\\Windows',python=join(this.paths.creation,'python'),node=join(this.paths.creation,'node');
  // The app's own ffmpeg and ffprobe, so the agent's programs can process media without installing them first.
  const mediaTools=[...new Set([dirname(this.paths.ffmpeg),dirname(this.paths.ffprobe)])].filter(dir=>existsSync(dir));
  // An explicit environment keeps app/provider credentials out of child processes.
  const shims=unixToolShims(join(cache,'unix-tools'),shell);
  const environment={SystemRoot:systemRoot,WINDIR:systemRoot,ComSpec:join(systemRoot,'System32','cmd.exe'),PATH:[join(root,'node_modules','.bin'),join(root,'.npm'),join(root,'.python-packages','bin'),join(root,'.venv','Scripts'),...(shared?[join(libraries,'node_modules','.bin')]:[]),node,python,...mediaTools,join(systemRoot,'System32'),shims].join(';'),PATHEXT:'.COM;.EXE;.BAT;.CMD',NODE_OPTIONS:'--preserve-symlinks --preserve-symlinks-main'+(shared?' --require='+JSON.stringify(join(libraries,'shared-modules.cjs')):''),...(shared?{NODE_PATH:join(libraries,'node_modules'),DREAM_SHARED_NODE:libraries}:{}),MPLCONFIGDIR:join(cache,'matplotlib'),IMAGEIO_FFMPEG_EXE:this.paths.ffmpeg,XDG_CACHE_HOME:cache,TEMP:cache,TMP:cache,DREAM_TEMP:longPath(join(cache,'tmp')),HOME:cache,USERPROFILE:cache,APPDATA:cache,LOCALAPPDATA:cache,PYTHONHOME:python,PYTHONPATH:[longPath(join(root,'.python-packages')),...(shared?[longPath(join(libraries,'python'))]:[])].join(';'),PYTHONNOUSERSITE:'1',PIP_TARGET:longPath(join(root,'.python-packages')),PIP_CACHE_DIR:join(cache,'pip'),PIP_DISABLE_PIP_VERSION_CHECK:'1',npm_config_cache:join(cache,'npm'),npm_config_prefix:join(root,'.npm'),npm_config_update_notifier:'false',npm_config_audit:'false',npm_config_dangerously_allow_all_scripts:'true',DREAM_WORKSPACE:root,DREAM_PYTHON_PACKAGES:longPath(join(root,'.python-packages'))};
  const controller=new AbortController();this.owned.add(controller);const stop=()=>controller.abort();signal.addEventListener('abort',stop,{once:true});
  // Old staged dream-render clients receive a terminal migration response; no
  // render implementation or rendering binaries are exposed to chat processes.
  const renderRequests=join(root,'.cache','render-requests');mkdirSync(renderRequests,{recursive:true});const handled=new Set(readdirSync(renderRequests));
  const renderTimer=setInterval(()=>{if(controller.signal.aborted)return;for(const file of readdirSync(renderRequests)){if(!/^[a-f0-9-]+\.json$/.test(file)||handled.has(file))continue;handled.add(file);const response=workspacePath(root,'.cache/render-requests/'+file.replace('.json','.result.json'));writeFileSync(response+'.tmp',JSON.stringify({error:'Chat does not render frames. Publish a live scene and use Export to render a video.'}));renameSync(response+'.tmp',response);}},100);

  writeFileSync(intentPath,JSON.stringify({id:request.id,commandHash,startedAt:new Date().toISOString()}));
  if(local)clearInterval(renderTimer);
  // Every command runs through the host, in a job object with a memory cap: on the user's computer as the user (their
  // programs and files, the workspace's tools first on PATH), otherwise in the AppContainer.
  const hostRequest=local?{...request,command:script,cwd,commandHash,receiptPath,shell,readRoots:[],environment:localEnvironment(environment),memoryLimitBytes:commandMemoryLimit(),local:true}:{...request,command:script,cwd,commandHash,receiptPath,shell,readRoots:[this.paths.creation,...(shared?[libraries]:[]),...mediaTools,sources,join(project,'Media')],environment,memoryLimitBytes:commandMemoryLimit()};
  return await new Promise<ProcessResult>((ok,fail)=>{
   const child=spawn(join(this.paths.creation,'host','creation-host.exe'),[],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{SystemRoot:systemRoot,DOTNET_EnableDiagnostics:'0',NODE_ENV:'production'}});let pending='',result:ProcessResult|undefined,error:Error|undefined;
   const cancel=()=>{if(child.stdin.writable)child.stdin.write('cancel\n');};controller.signal.addEventListener('abort',cancel,{once:true});
   child.stdin.on('error',()=>{});child.stdin.write(JSON.stringify(hostRequest)+'\n');if(signal.aborted)cancel();
   child.stdout.on('data',chunk=>{pending+=chunk.toString();let newline:number;while((newline=pending.indexOf('\n'))>=0){const line=pending.slice(0,newline);pending=pending.slice(newline+1);try{const data=JSON.parse(line);if(data.type==='output'){appendFileSync(logPath,data.text);onOutput(data.text);}if(data.type==='result')result={...data.result,logPath};if(data.type==='error')error=new Error(data.message);}catch(e){error=e as Error;cancel();}}});
   child.stderr.on('data',b=>appendFileSync(logPath,b));child.on('error',e=>{error=e;});
   child.on('close',()=>{clearInterval(renderTimer);controller.abort();signal.removeEventListener('abort',stop);controller.signal.removeEventListener('abort',cancel);this.owned.delete(controller);child.stdin.end();if(result)ok(result);else fail(error??new Error('Creation host ended without a process receipt. The last published video is unchanged.'));});
  });
 }
 stop(){for(const controller of this.owned)controller.abort();}
}
/** The environment of a command on the user's computer: theirs without the app's secrets, with the workspace's tools first
 * on PATH, the user's own after them and the Unix tool shims last; home and temp folders stay the user's. */
function localEnvironment(sandbox:Record<string,string>){
 const user=Object.fromEntries(Object.entries(process.env).filter(([key,value])=>value!==undefined&&!secret.test(key))) as Record<string,string>;
 const {HOME:_home,USERPROFILE:_profile,APPDATA:_appData,LOCALAPPDATA:_localAppData,TEMP:_temp,TMP:_tmp,SystemRoot:_root,WINDIR:_windir,ComSpec:_comspec,...tools}=sandbox;
 const [shims]=sandbox.PATH.split(';').slice(-1),own=sandbox.PATH.split(';').slice(0,-1).join(';');
 const env:Record<string,string>={...user,...tools,PATH:[own,user.PATH??user.Path??'',shims].filter(Boolean).join(';')};delete env.Path;return env;
}
