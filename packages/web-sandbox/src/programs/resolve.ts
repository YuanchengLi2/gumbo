import type {SandboxFS} from '../fs/types';
import {tryStat,readText} from '../fs/util';
import {join,dirname,resolve} from '../path';

/** Node's built-in modules: node's require serves them, esbuild leaves them external for platform node. */
export const BUILTINS=new Set(['assert','assert/strict','buffer','child_process','console','constants','crypto','events','fs','fs/promises','module','os','path','path/posix','perf_hooks','process','querystring','readline','readline/promises','stream','stream/promises','string_decoder','timers','timers/promises','tty','url','util','util/types','zlib','worker_threads','http','https','net','dns','tls','dgram','cluster','v8','vm','inspector','async_hooks','diagnostics_channel','http2','repl','test','sqlite']);
export const isBuiltin=(spec:string)=>spec.startsWith('node:')||BUILTINS.has(spec);
/** `fallbackConditions` are tried when `conditions` match no export: require() takes a package's "require" build like
 * Node, and an ESM-only package's "import" one otherwise (node compiles it). */
export interface ResolveOptions{extensions:string[];conditions:string[];mainFields:string[];fallbackConditions?:string[]}
const isFile=(fs:SandboxFS,path:string)=>tryStat(fs,path)?.type==='file';
const readJson=(fs:SandboxFS,path:string):any=>{try{return JSON.parse(readText(fs,path));}catch{return undefined;}};
/** A file path for an import: as written, with an extension added, ./x.js meaning ./x.ts, or a folder's index. */
export function resolveFile(fs:SandboxFS,path:string,options:ResolveOptions):string|undefined{
 if(isFile(fs,path))return path;
 for(const ext of options.extensions)if(isFile(fs,path+ext))return path+ext;
 const js=/\.(m|c)?jsx?$/.exec(path);if(js){const base=path.slice(0,-js[0].length);for(const ext of['.ts','.tsx','.mts','.cts'])if(isFile(fs,base+ext))return base+ext;}
 if(tryStat(fs,path)?.type==='directory'){
  const pkg=readJson(fs,join(path,'package.json'));
  for(const field of options.mainFields){const main=pkg?.[field];if(typeof main==='string'){const found=resolveFile(fs,join(path,main),options);if(found)return found;}}
  for(const ext of options.extensions)if(isFile(fs,join(path,'index'+ext)))return join(path,'index'+ext);
 }
 return undefined;
}
/** package.json "exports": subpath keys (with * patterns) and nested conditions. */
function exportsTarget(exports:any,subpath:string,conditions:string[]):string|undefined{
 const target=(value:any):string|undefined=>{
  if(typeof value==='string')return value;
  if(Array.isArray(value)){for(const v of value){const t=target(v);if(t)return t;}return undefined;}
  if(value&&typeof value==='object'){for(const [condition,v] of Object.entries(value))if(conditions.includes(condition)||condition==='default'){const t=target(v);if(t)return t;}}
  return undefined;
 };
 if(typeof exports==='string'||Array.isArray(exports))return subpath==='.'?target(exports):undefined;
 if(!exports||typeof exports!=='object')return undefined;
 const keys=Object.keys(exports);
 if(!keys.some(k=>k.startsWith('.')))return subpath==='.'?target(exports):undefined;
 if(subpath in exports)return target(exports[subpath]);
 for(const key of keys.filter(k=>k.includes('*')).sort((a,b)=>b.length-a.length)){
  const [prefix,suffix]=key.split('*');
  if(subpath.startsWith(prefix)&&subpath.endsWith(suffix)&&subpath.length>=prefix.length+suffix.length){const t=target(exports[key]);if(t)return t.replace(/\*/g,subpath.slice(prefix.length,subpath.length-suffix.length));}
 }
 return undefined;
}
/** Node-style resolution from a folder: relative and absolute paths, then node_modules up the tree. */
export function resolveModule(fs:SandboxFS,fromDir:string,spec:string,options:ResolveOptions):{path:string}|{builtin:string}|undefined{
 if(isBuiltin(spec))return{builtin:spec.replace(/^node:/,'')};
 if(spec.startsWith('./')||spec.startsWith('../')||spec==='.'||spec==='..'||spec.startsWith('/')){const path=resolveFile(fs,resolve(fromDir,spec),options);return path?{path}:undefined;}
 const parts=spec.split('/'),name=spec.startsWith('@')?parts.slice(0,2).join('/'):parts[0],sub=parts.slice(spec.startsWith('@')?2:1).join('/');
 for(let dir=fromDir;;dir=dirname(dir)){
  const pkgDir=join(dir,'node_modules',name);
  if(tryStat(fs,pkgDir)?.type==='directory'){
   const pkg=readJson(fs,join(pkgDir,'package.json'));
   if(pkg?.exports!==undefined){const key=sub?'./'+sub:'.',t=exportsTarget(pkg.exports,key,options.conditions)??(options.fallbackConditions&&exportsTarget(pkg.exports,key,options.fallbackConditions));if(t){const path=resolveFile(fs,join(pkgDir,t),options);if(path)return{path};}}
   const path=resolveFile(fs,sub?join(pkgDir,sub):pkgDir,options);if(path)return{path};
  }
  if(dirname(dir)===dir)break;
 }
 return undefined;
}
