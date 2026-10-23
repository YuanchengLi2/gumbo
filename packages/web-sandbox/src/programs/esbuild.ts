import {CommandError,type Command,type CommandContext,type Host} from '../shell/types';
import {EmptyInput} from '../shell/io';
import type {SandboxFS} from '../fs/types';
import {mkdirp} from '../fs/util';
import {dirname,extname,resolve,relative as posixRelative} from '../path';
import {resolveModule,isBuiltin,type ResolveOptions} from './resolve';
import type {SandboxAssets} from '../sandbox';
import type * as Esbuild from 'esbuild-wasm';

export const ESBUILD_VERSION='0.25.12';
const CDN=`https://cdn.jsdelivr.net/npm/esbuild-wasm@${ESBUILD_VERSION}/`;
type EsbuildApi=typeof Esbuild;
let loading:Promise<EsbuildApi>|undefined;
const inNode=typeof process!=='undefined'&&!!process.versions?.node&&typeof (globalThis as {WorkerGlobalScope?:unknown}).WorkerGlobalScope==='undefined';
/** Loads esbuild-wasm once per worker (about 12 MB of wasm); node uses it too, for TypeScript and ES modules. */
export function loadEsbuild(host:Host):Promise<EsbuildApi>{
 loading??=(async()=>{
  const assets=host.assets as SandboxAssets|undefined;
  if(inNode&&!assets?.esbuildModule){const specifier='esbuild-wasm';return await import(/* @vite-ignore */ specifier) as EsbuildApi;}
  const module:EsbuildApi=await import(/* @vite-ignore */ assets?.esbuildModule??CDN+'esm/browser.min.js');
  await module.initialize({wasmURL:assets?.esbuildWasm??CDN+'esbuild.wasm',worker:false});
  return module;
 })();
 loading.catch(()=>{loading=undefined;});
 return loading;
}
const LOADERS:Record<string,Esbuild.Loader>={'.js':'js','.mjs':'js','.cjs':'js','.jsx':'jsx','.ts':'ts','.mts':'ts','.cts':'ts','.tsx':'tsx','.json':'json','.css':'css','.txt':'text'};
export const loaderFor=(path:string,overrides:Record<string,Esbuild.Loader>={})=>overrides[extname(path)]??LOADERS[extname(path)];
/** esbuild's file access in the browser: resolution and loading through the sandbox's file system. */
export function sandboxPlugin(fs:SandboxFS,options:{platform:string;externals:string[];alias:Record<string,string>;loaders:Record<string,Esbuild.Loader>;mainFields?:string[];conditions?:string[]}):Esbuild.Plugin{
 const browser=options.platform==='browser';
 const resolveOptions:ResolveOptions={extensions:['.tsx','.ts','.jsx','.js','.mjs','.cjs','.css','.json'],conditions:options.conditions??(browser?['browser','import','module']:options.platform==='node'?['node','import','module','require']:['import','module']),mainFields:options.mainFields??(browser?['browser','module','main']:['module','main'])};
 const external=(path:string)=>options.externals.some(e=>e===path||path.startsWith(e+'/')||(e.includes('*')&&new RegExp('^'+e.split('*').map(s=>s.replace(/[.+?^${}()|[\]\\]/g,'\\$&')).join('.*')+'$').test(path)));
 return{name:'sandbox-fs',setup(build){
  build.onResolve({filter:/.*/},args=>{
   let path=args.path;for(const [from,to] of Object.entries(options.alias))if(path===from||path.startsWith(from+'/')){path=to+path.slice(from.length);break;}
   if(args.kind!=='entry-point'&&external(path))return{path,external:true};
   if(/^(https?:|data:)/.test(path))return{path,external:true};
   // The importer's own folder, not esbuild's resolveDir, which under Node on Windows turns into a drive path.
   const from=args.namespace==='sandbox'&&args.importer?dirname(args.importer):args.resolveDir?.startsWith('/')?args.resolveDir:'/';
   const found=resolveModule(fs,from,path,resolveOptions);
   if(found&&'builtin' in found){if(options.platform==='node')return{path,external:true};return{errors:[{text:`Could not resolve "${path}": it is a Node built-in module; for the browser leave it out or mark it --external:${path}`}]};}
   if(!found)return{errors:[{text:`Could not resolve "${path}"`+(/^[@\w]/.test(path)&&!isBuiltin(path)?` (no node_modules/${path.split('/')[0]} in the workspace: npm is not available, so bring the library's files into the workspace)`:'')}]};
   return{path:found.path,namespace:'sandbox'};
  });
  build.onLoad({filter:/.*/,namespace:'sandbox'},args=>{
   const loader=loaderFor(args.path,options.loaders);
   if(!loader)return{errors:[{text:`No loader is configured for "${extname(args.path)}" files: ${args.path} (pass --loader:${extname(args.path)}=file or dataurl)`}]};
   return{contents:fs.readFile(args.path),loader,resolveDir:dirname(args.path)};
  });
 }};
}
const size=(n:number)=>n<1024?n+'b':n<1048576?(n/1024).toFixed(1)+'kb':(n/1048576).toFixed(1)+'mb';
/** The esbuild command line: entry points, --bundle, --outfile/--outdir, --format, --platform, --minify, --sourcemap,
 * --loader:.x=y, --define:K=V, --external:x, --jsx…, or a transform of stdin. Files never leave the sandbox. */
export const esbuild:Command=async ctx=>{
 const entries:string[]=[],options:Esbuild.BuildOptions={},loaders:Record<string,Esbuild.Loader>={},define:Record<string,string>={},externals:string[]=[],alias:Record<string,string>={},banner:Record<string,string>={},footer:Record<string,string>={};
 let logLevel='info',stdinLoader:Esbuild.Loader|undefined,metafile:string|undefined;
 for(const arg of ctx.args){
  if(arg==='--version'){await ctx.out(ESBUILD_VERSION+'\n');return 0;}
  if(arg==='--help'||arg==='-h'){await ctx.out('Usage: esbuild [options] [entry points]\nesbuild-wasm '+ESBUILD_VERSION+' in the browser sandbox (no --watch or --serve).\n');return 0;}
  if(!arg.startsWith('--')){entries.push(arg);continue;}
  const eq=arg.indexOf('='),colon=arg.indexOf(':'),name=arg.slice(2,colon>0&&(eq<0||colon<eq)?colon:eq<0?undefined:eq),value=eq<0?undefined:arg.slice(eq+1);
  const keyed=colon>0&&(eq<0||colon<eq)?arg.slice(colon+1,eq<0?undefined:eq):undefined;
  switch(name){
   case'bundle':options.bundle=true;break;case'minify':options.minify=true;break;case'minify-whitespace':options.minifyWhitespace=true;break;case'minify-identifiers':options.minifyIdentifiers=true;break;case'minify-syntax':options.minifySyntax=true;break;
   case'outfile':options.outfile=value;break;case'outdir':options.outdir=value;break;case'outbase':options.outbase=value;break;
   case'format':options.format=value as Esbuild.Format;break;case'platform':options.platform=value as Esbuild.Platform;break;case'target':options.target=value?.split(',');break;
   case'global-name':options.globalName=value;break;case'sourcemap':options.sourcemap=value===undefined?true:value as Esbuild.BuildOptions['sourcemap'];break;case'sources-content':options.sourcesContent=value!=='false';break;
   case'splitting':options.splitting=true;break;case'keep-names':options.keepNames=true;break;case'tree-shaking':options.treeShaking=value!=='false';break;
   case'jsx':options.jsx=value as Esbuild.BuildOptions['jsx'];break;case'jsx-factory':options.jsxFactory=value;break;case'jsx-fragment':options.jsxFragment=value;break;case'jsx-import-source':options.jsxImportSource=value;break;case'jsx-dev':options.jsxDev=true;break;
   case'loader':if(keyed!==undefined){loaders[keyed]=value as Esbuild.Loader;}else stdinLoader=value as Esbuild.Loader;break;
   case'define':if(keyed!==undefined&&value!==undefined)define[keyed]=value;break;
   case'external':if(keyed!==undefined)externals.push(keyed);break;
   case'alias':if(keyed!==undefined&&value!==undefined)alias[keyed]=value;break;
   case'banner':if(keyed!==undefined&&value!==undefined)banner[keyed]=value;break;case'footer':if(keyed!==undefined&&value!==undefined)footer[keyed]=value;break;
   case'packages':if(value==='external')options.packages='external';break;
   case'main-fields':options.mainFields=value?.split(',');break;case'conditions':options.conditions=value?.split(',');break;
   case'legal-comments':options.legalComments=value as Esbuild.BuildOptions['legalComments'];break;case'charset':options.charset=value as 'utf8';break;
   case'log-level':logLevel=value??'info';break;case'metafile':metafile=value;options.metafile=true;break;
   case'drop':if(keyed!==undefined)(options.drop??=[]).push(keyed as 'console');break;case'pure':if(keyed!==undefined)(options.pure??=[]).push(keyed);break;
   case'public-path':options.publicPath=value;break;case'entry-names':options.entryNames=value;break;case'chunk-names':options.chunkNames=value;break;case'asset-names':options.assetNames=value;break;
   case'out-extension':if(keyed!==undefined&&value!==undefined)(options.outExtension??={})[keyed]=value;break;
   case'tsconfig':case'tsconfig-raw':case'allow-overwrite':case'color':case'log-limit':case'analyze':case'preserve-symlinks':case'resolve-extensions':break;
   case'watch':case'serve':case'servedir':throw new CommandError(`--${name} is not available in the browser sandbox; run the build again after changes`,1);
   default:throw new CommandError(`Invalid build flag: "${arg}"`,1);
  }
 }
 const api=await loadEsbuild(ctx.host),started=Date.now(),quiet=logLevel==='silent'||logLevel==='error';
 const report=async(result:{errors:Esbuild.Message[];warnings:Esbuild.Message[]})=>{
  if(result.warnings.length&&!quiet&&logLevel!=='warning')for(const m of await api.formatMessages(result.warnings,{kind:'warning',color:false}))await ctx.err(m);
  for(const m of await api.formatMessages(result.errors,{kind:'error',color:false}))await ctx.err(m);
 };
 // No entry points: transform stdin, as `esbuild --loader=ts < file.ts` does.
 if(!entries.length){
  if(ctx.stdin instanceof EmptyInput)throw new CommandError('No entry points given (and nothing on stdin)',1);
  try{
   const result=await api.transform(await ctx.stdin.text(),{loader:stdinLoader??'js',format:options.format,minify:options.minify,target:options.target,sourcemap:options.sourcemap?'inline':undefined,jsx:options.jsx as 'transform',jsxFactory:options.jsxFactory,jsxFragment:options.jsxFragment,define,platform:options.platform,globalName:options.globalName,logLevel:'silent'});
   if(options.outfile){const path=ctx.resolve(options.outfile);mkdirp(ctx.fs,dirname(path));ctx.fs.writeFile(path,new TextEncoder().encode(result.code));}else await ctx.out(result.code);
   await report({errors:[],warnings:result.warnings});return 0;
  }catch(error){await report(error as {errors:Esbuild.Message[];warnings:Esbuild.Message[]});return 1;}
 }
 const platform=options.platform??'browser';
 try{
  // esbuild's own working directory is a disk it can see (none in the browser, the real one under Node), not the
  // sandbox's files: inputs go in absolute through the plugin, outputs relative, and come back through the metafile's
  // relative names onto the command's folder.
  const rel=(p?:string)=>p===undefined?undefined:posixRelative(ctx.cwd,ctx.resolve(p));
  const result=await api.build({...options,outfile:rel(options.outfile),outdir:rel(options.outdir),outbase:rel(options.outbase),entryPoints:entries.map(e=>ctx.resolve(e)),write:false,metafile:true,logLevel:'silent',define,banner,footer,
   plugins:[sandboxPlugin(ctx.fs,{platform,externals,alias,loaders,mainFields:options.mainFields,conditions:options.conditions})]});
  const toStdout=!options.outfile&&!options.outdir,names=Object.keys(result.metafile?.outputs??{});
  for(const file of result.outputFiles??[]){
   if(toStdout&&!file.path.endsWith('.map')){await ctx.stdout.write(file.contents);continue;}
   const actual=file.path.replace(/\\/g,'/'),name=names.find(n=>actual===n||actual.endsWith('/'+n.replace(/^(\.\.\/)+/,'')))??posixRelative('/',actual);
   const target=resolve(ctx.cwd,name);(file as {sandboxPath?:string}).sandboxPath=target;mkdirp(ctx.fs,dirname(target));ctx.fs.writeFile(target,file.contents);
  }
  if(metafile&&result.metafile){const path=ctx.resolve(metafile);mkdirp(ctx.fs,dirname(path));ctx.fs.writeFile(path,new TextEncoder().encode(JSON.stringify(result.metafile)));}
  await report(result);
  if(!toStdout&&!quiet){const lines=(result.outputFiles??[]).map(f=>`  ${posixRelative(ctx.cwd,(f as {sandboxPath?:string}).sandboxPath??f.path)}  ${size(f.contents.length)}`);await ctx.err(`\n${lines.join('\n')}\n\n⚡ Done in ${Date.now()-started}ms\n`);}
  return 0;
 }catch(error){const e=error as {errors?:Esbuild.Message[];warnings?:Esbuild.Message[]};if(!e.errors)throw error;await report({errors:e.errors,warnings:e.warnings??[]});await ctx.err(`${e.errors.length} error${e.errors.length===1?'':'s'}\n`);return 1;}
};
/** TypeScript, JSX and ES modules for node's require: one file to CommonJS, no bundling. */
export async function toCommonJS(host:Host,source:string,path:string):Promise<string>{
 const api=await loadEsbuild(host);
 const result=await api.transform(source,{loader:loaderFor(path)??'js',format:'cjs',platform:'node',target:'es2022',sourcefile:path,sourcemap:'inline',logLevel:'silent'});
 return result.code;
}
/** For a module with top-level await, which CommonJS cannot hold: types and JSX stripped, imports and exports kept. */
export async function stripToESM(host:Host,source:string,path:string):Promise<string>{
 const api=await loadEsbuild(host);
 return(await api.transform(source,{loader:loaderFor(path)??'js',format:'esm',platform:'node',target:'es2022',sourcefile:path,logLevel:'silent'})).code;
}
export const formatError=async(host:Host,error:unknown)=>{const e=error as {errors?:Esbuild.Message[]};if(!e.errors)return String((error as Error)?.message??error);const api=await loadEsbuild(host);return(await api.formatMessages(e.errors,{kind:'error',color:false})).join('');};
