import {spawn} from 'node:child_process';
import {existsSync,readFileSync,mkdirSync,appendFileSync,writeFileSync,readdirSync,renameSync} from 'node:fs';
import {join,resolve,dirname,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {ProcessRequestSchema,type ProcessRequest,type ProcessResult} from '@dream/contracts';
import {workspacePath} from '../../../../packages/project-db/src/workspace-store';

const hash=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
export class CodeRuntime {
 private owned=new Set<AbortController>();
 constructor(private paths:{creation:string;ffmpeg:string;ffprobe:string;browser:string},private qualification=false){}
 check(){
  if(process.platform!=='win32')throw new Error('Automatic creation is not yet qualified on this platform.');
  const path=join(this.paths.creation,'manifest.json');if(!existsSync(path))throw new Error('The bundled creation environment is missing. Stage the pinned runtimes.');
  if(!this.qualification){const file=join(this.paths.creation,'qualification.json');if(!existsSync(file))throw new Error('The creation environment has not passed its native qualification.');const result=JSON.parse(readFileSync(file,'utf8'));if(result.manifestHash!==hash(readFileSync(path))||result.passed!==true)throw new Error('The creation environment changed and needs native qualification.');}
 }
 async run(raw:ProcessRequest,signal:AbortSignal,onOutput:(text:string)=>void):Promise<ProcessResult>{
  this.check();const request=ProcessRequestSchema.parse(raw);signal.throwIfAborted();const root=resolve(request.workspace),cwd=workspacePath(root,request.cwd),project=dirname(root),recordRoot=join(project,'.dream','processes');
  if(relative(project,root)!=='Workspace')throw new Error('Invalid project workspace.');mkdirSync(recordRoot,{recursive:true});
  const commandHash=hash(JSON.stringify({command:request.command,cwd:request.cwd})),receiptPath=join(recordRoot,request.id+'.json'),intentPath=join(recordRoot,request.id+'.intent.json'),logPath=join(recordRoot,request.id+'.log');
  if(existsSync(receiptPath)){const saved=JSON.parse(readFileSync(receiptPath,'utf8'));if(saved.commandHash!==commandHash)throw new Error('Process identity mismatch.');return{...saved,logPath};}
  if(existsSync(intentPath))throw new Error('This process was interrupted without a terminal receipt. Inspect its log and outputs before issuing a new command.');
  const manifest=JSON.parse(readFileSync(join(this.paths.creation,'manifest.json'),'utf8'));
  for(const file of ['host/creation-host.exe','node/node.exe','python/python.exe'])if(hash(readFileSync(join(this.paths.creation,file)))!==manifest.files[file])throw new Error('Bundled creation runtime integrity check failed.');
  const libraries=join(dirname(this.paths.creation),'libraries'),shared=existsSync(join(libraries,'libraries.json'));
  const cache=join(root,'.cache'),sources=join(project,'Sources');mkdirSync(cache,{recursive:true});mkdirSync(sources,{recursive:true});mkdirSync(join(project,'Media'),{recursive:true});
  const longPath=(path:string)=>path.startsWith('\\\\?\\')?path:'\\\\?\\'+path;
  const systemRoot=process.env.SystemRoot??'C:\\Windows',python=join(this.paths.creation,'python'),node=join(this.paths.creation,'node');
  // An explicit environment keeps app/provider credentials out of child processes.
  const environment={SystemRoot:systemRoot,WINDIR:systemRoot,ComSpec:join(systemRoot,'System32','cmd.exe'),PATH:[join(root,'node_modules','.bin'),join(root,'.npm'),join(root,'.python-packages','bin'),join(root,'.venv','Scripts'),...(shared?[join(libraries,'node_modules','.bin')]:[]),node,python,join(systemRoot,'System32')].join(';'),PATHEXT:'.COM;.EXE;.BAT;.CMD',NODE_OPTIONS:'--preserve-symlinks --preserve-symlinks-main'+(shared?' --require='+JSON.stringify(join(libraries,'shared-modules.cjs')):''),...(shared?{NODE_PATH:join(libraries,'node_modules'),DREAM_SHARED_NODE:libraries}:{}),MPLCONFIGDIR:join(cache,'matplotlib'),XDG_CACHE_HOME:cache,TEMP:cache,TMP:cache,DREAM_TEMP:longPath(join(cache,'tmp')),HOME:cache,USERPROFILE:cache,APPDATA:cache,LOCALAPPDATA:cache,PYTHONHOME:python,PYTHONPATH:[longPath(join(root,'.python-packages')),...(shared?[longPath(join(libraries,'python'))]:[])].join(';'),PYTHONNOUSERSITE:'1',PIP_TARGET:longPath(join(root,'.python-packages')),PIP_CACHE_DIR:join(cache,'pip'),PIP_DISABLE_PIP_VERSION_CHECK:'1',npm_config_cache:join(cache,'npm'),npm_config_prefix:join(root,'.npm'),npm_config_update_notifier:'false',npm_config_audit:'false',npm_config_dangerously_allow_all_scripts:'true',DREAM_WORKSPACE:root,DREAM_PYTHON_PACKAGES:longPath(join(root,'.python-packages'))};
  const controller=new AbortController();this.owned.add(controller);const stop=()=>controller.abort();signal.addEventListener('abort',stop,{once:true});
  // Old staged dream-render clients receive a terminal migration response; no
  // render implementation or rendering binaries are exposed to chat processes.
  const renderRequests=join(root,'.cache','render-requests');mkdirSync(renderRequests,{recursive:true});const handled=new Set(readdirSync(renderRequests));
  const renderTimer=setInterval(()=>{if(controller.signal.aborted)return;for(const file of readdirSync(renderRequests)){if(!/^[a-f0-9-]+\.json$/.test(file)||handled.has(file))continue;handled.add(file);const response=workspacePath(root,'.cache/render-requests/'+file.replace('.json','.result.json'));writeFileSync(response+'.tmp',JSON.stringify({error:'Chat does not render frames. Publish a live scene and use Export to render a video.'}));renameSync(response+'.tmp',response);}},100);

  writeFileSync(intentPath,JSON.stringify({id:request.id,commandHash,startedAt:new Date().toISOString()}));
  return await new Promise<ProcessResult>((ok,fail)=>{
   const child=spawn(join(this.paths.creation,'host','creation-host.exe'),[],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{SystemRoot:systemRoot,DOTNET_EnableDiagnostics:'0',NODE_ENV:'production'}});let pending='',result:ProcessResult|undefined,error:Error|undefined;
   const cancel=()=>{if(child.stdin.writable)child.stdin.write('cancel\n');};controller.signal.addEventListener('abort',cancel,{once:true});
   child.stdin.on('error',()=>{});child.stdin.write(JSON.stringify({...request,cwd,commandHash,receiptPath,readRoots:[this.paths.creation,...(shared?[libraries]:[]),sources,join(project,'Media')],environment})+'\n');if(signal.aborted)cancel();
   child.stdout.on('data',chunk=>{pending+=chunk.toString();let newline:number;while((newline=pending.indexOf('\n'))>=0){const line=pending.slice(0,newline);pending=pending.slice(newline+1);try{const data=JSON.parse(line);if(data.type==='output'){appendFileSync(logPath,data.text);onOutput(data.text);}if(data.type==='result')result={...data.result,logPath};if(data.type==='error')error=new Error(data.message);}catch(e){error=e as Error;cancel();}}});
   child.stderr.on('data',b=>appendFileSync(logPath,b));child.on('error',e=>{error=e;});
   child.on('close',()=>{clearInterval(renderTimer);controller.abort();signal.removeEventListener('abort',stop);controller.signal.removeEventListener('abort',cancel);this.owned.delete(controller);child.stdin.end();if(result)ok(result);else fail(error??new Error('Creation host ended without a process receipt. The last published video is unchanged.'));});
  });
 }
 stop(){for(const controller of this.owned)controller.abort();}
}
