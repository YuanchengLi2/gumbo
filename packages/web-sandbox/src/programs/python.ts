import {CommandError,type Command,type CommandContext,type Host} from '../shell/types';
import {EmptyInput} from '../shell/io';
import {mountSandbox} from './emscripten-fs';
import {mkdirp,decode} from '../fs/util';
import type {SandboxAssets} from '../sandbox';

/** Keep in step with package.json: the CDN folder for numpy, Pillow and the other wheels is named after it. */
export const PYODIDE_VERSION='314.0.7',PYTHON_VERSION='3.14.2';
const CDN=`https://cdn.jsdelivr.net/pyodide/v${PYODIDE_VERSION}/full/`;
/** Runs one python invocation inside the long-lived interpreter: argv, environment and folder are the command's, the
 * namespace is fresh, exit codes come from SystemExit, and tracebacks leave out this driver's own frames. */
const DRIVER=`
import sys, os, json, runpy, traceback, importlib
__sandbox_path = [p for p in sys.path if p]
def __sandbox_run(mode, target, argv, env, cwd, roots):
    sys.argv = json.loads(argv)
    os.environ.clear(); os.environ.update(json.loads(env))
    os.chdir(cwd)
    sys.path[:] = [os.path.dirname(os.path.abspath(target)) if mode == 'file' else cwd] + __sandbox_path
    importlib.invalidate_caches()
    try:
        if mode == 'code':
            exec(compile(target, '<string>', 'exec'), {'__name__': '__main__', '__builtins__': __builtins__})
        elif mode == 'file':
            runpy.run_path(target, run_name='__main__')
        else:
            runpy.run_module(target, run_name='__main__', alter_sys=True)
        return 0
    except SystemExit as e:
        code = e.code
        if code is None: return 0
        if isinstance(code, int): return code & 255
        print(code, file=sys.stderr); return 1
    except BaseException as e:
        te = traceback.TracebackException.from_exception(e)
        te.stack = traceback.StackSummary.from_list([f for f in te.stack if f.name != '__sandbox_run' and 'runpy' not in f.filename])
        sys.stderr.write(''.join(te.format()))
        return 130 if isinstance(e, KeyboardInterrupt) else 1
    finally:
        try: sys.stdout.flush(); sys.stderr.flush()
        except Exception: pass
        # Modules imported from the workspace are dropped, so an edited helper.py is read again next time.
        for name, module in list(sys.modules.items()):
            if (getattr(module, '__file__', None) or '').startswith(tuple(json.loads(roots))): del sys.modules[name]
`;
type Pyodide=any;
let loading:Promise<Pyodide>|undefined;let queue:Promise<unknown>=Promise.resolve();
const inNode=typeof process!=='undefined'&&!!process.versions?.node&&typeof (globalThis as {WorkerGlobalScope?:unknown}).WorkerGlobalScope==='undefined';
/** Loads Pyodide once per worker (about 13 MB: the wasm, the standard library and the JS); later runs reuse it. */
export function loadPython(host:Host):Promise<Pyodide>{
 loading??=(async()=>{
  const assets=host.assets as SandboxAssets|undefined,base=assets?.pyodide??(inNode?undefined:CDN);
  const specifier=base?base+'pyodide.mjs':'pyodide';
  const {loadPyodide}=await import(/* @vite-ignore */ specifier);
  // Under Node (tests) Pyodide caches wheels next to itself and reads packageBaseUrl as that folder, so it is left out.
  const py=await loadPyodide({...(base?{indexURL:base}:{}),...(inNode?{}:{packageBaseUrl:assets?.pyodidePackages??CDN}),env:{HOME:'/home/pyodide'},stdout:()=>{},stderr:()=>{}});
  py.runPython(DRIVER);
  host.reportMemory('python',()=>py._module?.HEAPU8?.buffer?.byteLength??0);
  return py;
 })();
 loading.catch(()=>{loading=undefined;});
 return loading;
}
/** One Python program at a time: the interpreter, its stdout and its folder are shared. */
function exclusive<T>(f:()=>Promise<T>):Promise<T>{const run=queue.then(f,f);queue=run.catch(()=>{});return run;}
/** Sends the interpreter's stdout and stderr to the command's streams as it writes them, and serves stdin. */
async function attach(py:Pyodide,ctx:CommandContext){
 const writer=(out:CommandContext['stdout'])=>({isatty:false,write:(buffer:Uint8Array)=>{void out.write(buffer.slice()).catch(()=>{});return buffer.length;}});
 py.setStdout(writer(ctx.stdout));py.setStderr(writer(ctx.stderr));
 let input=ctx.stdin instanceof EmptyInput?new Uint8Array():await ctx.stdin.readAll(256<<20),at=0;
 py.setStdin({read:(buffer:Uint8Array)=>{const n=Math.min(buffer.length,input.length-at);buffer.set(input.subarray(at,at+n));at+=n;return n;},isatty:false});
 return()=>{input=new Uint8Array();};
}
function prepare(py:Pyodide,ctx:CommandContext){
 const workspace=ctx.host.workspace,codes=py.ERRNO_CODES;
 mountSandbox(py.FS,ctx.fs,workspace,codes);
 // /tmp too, so a file the shell wrote to /tmp is the one Python opens.
 try{mkdirp(ctx.fs,'/tmp');mountSandbox(py.FS,ctx.fs,'/tmp',codes);}catch{}
 if(!ctx.cwd.startsWith(workspace+'/')&&ctx.cwd!==workspace&&ctx.cwd!=='/tmp'&&!ctx.cwd.startsWith('/tmp/')){const top='/'+ctx.cwd.split('/')[1];if(!['/lib','/dev','/proc','/home','/usr','/bin','/etc','/sys'].includes(top))mountSandbox(py.FS,ctx.fs,top,codes);}
 if(ctx.host.interrupt){Atomics.store(ctx.host.interrupt,0,0);py.setInterruptBuffer(ctx.host.interrupt);}
}
const usage='usage: python3 [-c cmd | -m mod | file | -] [arg] ...';
export const python:Command=async ctx=>{
 const args=ctx.args.slice();let mode:'code'|'file'|'module'|'stdin'|undefined,target='';
 while(args.length){
  const a=args.shift()!;
  if(a==='-c'){mode='code';target=args.shift()??'';break;}
  if(a.startsWith('-c')&&a.length>2){mode='code';target=a.slice(2);break;}
  if(a==='-m'){mode='module';target=args.shift()??'';break;}
  if(a==='-'){mode='stdin';break;}
  if(a==='-V'||a==='--version'){await ctx.out(`Python ${PYTHON_VERSION}\n`);return 0;}
  if(a==='-h'||a==='--help'){await ctx.out(usage+'\nThis Python is Pyodide in the browser: numpy, Pillow, scipy, opencv-python and matplotlib load on import; pip install works for pure-Python packages.\n');return 0;}
  if(a==='-W'||a==='-X'||a==='--check-hash-based-pycs'){args.shift();continue;}
  if(/^-[uBEsSOIqvbd]+$/.test(a)||a.startsWith('-W')||a.startsWith('-X'))continue;
  if(a.startsWith('-'))throw new CommandError(`unknown option ${a}\n${usage}`,2);
  mode='file';target=a;break;
 }
 if(mode==='module'&&target==='pip')return pip({...ctx,args});
 if(mode==='module'&&['venv','http.server','ensurepip'].includes(target))throw new CommandError(`python -m ${target} is not available in the browser sandbox`,1);
 let code=target;
 if(mode===undefined||mode==='stdin'){code=await ctx.stdin.text();mode='code';if(!code.trim())return 0;args.unshift('-');}
 else if(mode==='file'){const path=ctx.resolve(target);try{code=decode(ctx.fs.readFile(path));}catch{await ctx.err(`python3: can't open file '${path}': [Errno 2] No such file or directory\n`);return 2;}target=path;}
 const argv=mode==='code'?[args[0]==='-'?'-':'-c',...args.slice(args[0]==='-'?1:0)]:mode==='file'?[target,...args]:[target,...args];
 const py=await loadPython(ctx.host);
 return exclusive(async()=>{
  const detach=await attach(py,ctx);
  try{
   prepare(py,ctx);
   // numpy, PIL and the other packages Pyodide builds load from the script's own imports.
   if(mode!=='module')await py.loadPackagesFromImports(code,{messageCallback:()=>{},errorCallback:(m:string)=>{void ctx.err(m+'\n');}});
   const run=py.globals.get('__sandbox_run');
   // Python's own errors end inside the driver; anything reaching here broke the interpreter, so the next command loads a new one.
   try{return Number(run(mode,mode==='code'?code:target,JSON.stringify(argv),JSON.stringify(ctx.env),ctx.cwd,JSON.stringify([ctx.host.workspace+'/','/tmp/'])));}
   catch(error){loading=undefined;throw new CommandError(`the Python interpreter failed (${(error as Error).message.split('\n')[0]}); it starts fresh on the next command`,1);}
   finally{try{run.destroy?.();}catch{}}
  }finally{detach();if(ctx.host.interrupt)Atomics.store(ctx.host.interrupt,0,0);}
 });
};
/** pip, through micropip: pure-Python wheels from PyPI and Pyodide's own builds (numpy, scipy, opencv-python …). */
export const pip:Command=async ctx=>{
 const args=ctx.args.filter(a=>!['--disable-pip-version-check','--no-cache-dir','-q','--quiet','--no-input','--user','--break-system-packages','--no-warn-script-location','--root-user-action=ignore'].includes(a));
 const sub=args.shift();
 if(!sub||sub==='-h'||sub==='--help'){await ctx.out('usage: pip install|uninstall|list|freeze|show PACKAGE...\n');return 0;}
 if(sub==='--version'||sub==='-V'){await ctx.out('pip (micropip) for Python '+PYTHON_VERSION+' in the browser sandbox\n');return 0;}
 const py=await loadPython(ctx.host);
 return exclusive(async()=>{
  await py.loadPackage('micropip',{messageCallback:()=>{}});const micropip=py.pyimport('micropip');
  const installed=():Record<string,string>=>JSON.parse(py.runPython('import micropip, json; json.dumps({k: v.version for k, v in micropip.list().items()})'));
  switch(sub){
   case'install':{
    const packages:string[]=[];let deps=true,pre=false;
    for(let i=0;i<args.length;i++){
     const a=args[i];
     if(a==='-r'||a==='--requirement'){const file=args[++i]??'';try{packages.push(...decode(ctx.fs.readFile(ctx.resolve(file))).split('\n').map(l=>l.replace(/#.*/,'').trim()).filter(l=>l&&!l.startsWith('-')));}catch{throw new CommandError(`Could not open requirements file: ${file}`,1);}continue;}
     if(a==='--no-deps'){deps=false;continue;}if(a==='--pre'){pre=true;continue;}
     if(a==='-t'||a==='--target'||a==='--prefix'||a==='-i'||a==='--index-url'||a==='--extra-index-url'||a==='-c'){i++;continue;}
     if(a==='-e'||a==='--editable')throw new CommandError('editable installs are not available in the browser sandbox',1);
     if(a.startsWith('-'))continue;
     packages.push(a);
    }
    if(!packages.length)throw new CommandError('You must give at least one requirement to install',1);
    const before=installed();
    try{await micropip.install.callKwargs(py.toPy(packages),{keep_going:true,deps,pre});}
    catch(error){const message=String((error as Error).message??error).split('\n').filter(l=>l.trim()).slice(-3).join('\n');await ctx.err(`ERROR: ${message}\nIn the browser pip installs pure-Python packages and the ones Pyodide builds (numpy, scipy, opencv-python, matplotlib …); packages with other native code cannot be installed.\n`);return 1;}
    const after=installed(),added=Object.entries(after).filter(([n,v])=>before[n]!==v).map(([n,v])=>`${n}-${v}`);
    await ctx.out(added.length?`Successfully installed ${added.join(' ')}\n`:`Requirement already satisfied: ${packages.join(', ')}\n`);return 0;
   }
   case'uninstall':{const names=args.filter(a=>!a.startsWith('-'));micropip.uninstall(py.toPy(names));await ctx.out(names.map(n=>`Successfully uninstalled ${n}\n`).join(''));return 0;}
   case'list':{const list=installed();const width=Math.max(7,...Object.keys(list).map(n=>n.length));await ctx.out(`${'Package'.padEnd(width)} Version\n${'-'.repeat(width)} -------\n`+Object.entries(list).sort().map(([n,v])=>`${n.padEnd(width)} ${v}\n`).join(''));return 0;}
   case'freeze':{await ctx.out(Object.entries(installed()).sort().map(([n,v])=>`${n}==${v}\n`).join(''));return 0;}
   case'show':{const list=installed();let status=0;for(const name of args.filter(a=>!a.startsWith('-'))){const key=Object.keys(list).find(k=>k.toLowerCase()===name.toLowerCase());if(!key){await ctx.err(`WARNING: Package(s) not found: ${name}\n`);status=1;continue;}await ctx.out(`Name: ${key}\nVersion: ${list[key]}\n`);}return status;}
  }
  throw new CommandError(`pip ${sub} is not available in the browser sandbox (install, uninstall, list, freeze and show are)`,1);
 });
};
