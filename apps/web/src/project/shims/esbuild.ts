import type * as Esbuild from 'esbuild';
import {dirname} from 'path-browserify';
import {nodeLikeFS,type NodeLikeFS} from '@dream/web-sandbox';
import {loadEsbuild,loaderFor} from '../../../../../packages/web-sandbox/src/programs/esbuild';
import {resolveModule} from '../../../../../packages/web-sandbox/src/programs/resolve';
import type {Host} from '../../../../../packages/web-sandbox/src/shell/types';
import * as fs from '../fs/sync-fs';

/** esbuild for the project service in the browser, which gets it from require('esbuild') (engine-compile.ts compiles
 * scenes with it, bundle-scene.ts bundles for bundle_scene). It is esbuild-wasm, loaded as the command sandbox loads it,
 * with the project's files read through this worker's synchronous file system: esbuild in a browser reads no files
 * itself. Paths stay in esbuild's own file namespace, so a build's metafile names them as on the desktop. */
const files=nodeLikeFS(fs as unknown as NodeLikeFS);
const host={assets:undefined} as unknown as Host;
function projectFiles(options:Esbuild.BuildOptions):Esbuild.Plugin{
 const browser=(options.platform??'browser')==='browser';
 const resolving={extensions:['.tsx','.ts','.jsx','.js','.mjs','.cjs','.css','.json'],conditions:options.conditions??(browser?['browser','import','module']:['import','module']),mainFields:options.mainFields??(browser?['browser','module','main']:['module','main'])};
 return{name:'project-files',setup(build){
  build.onResolve({filter:/.*/},args=>{
   if(args.namespace!=='file'&&args.kind!=='entry-point')return undefined;
   if(/^(https?:|data:)/.test(args.path)||(options.external??[]).includes(args.path))return{path:args.path,external:true};
   const found=resolveModule(files,args.importer?dirname(args.importer):args.resolveDir||options.absWorkingDir||'/',args.path,resolving);
   if(!found||'builtin' in found)return{errors:[{text:`Could not resolve "${args.path}"`}]};
   return{path:found.path};
  });
  build.onLoad({filter:/.*/,namespace:'file'},args=>{
   const loader=loaderFor(args.path,options.loader as Record<string,Esbuild.Loader>|undefined);
   return loader?{contents:fs.readFileSync(args.path),loader,resolveDir:dirname(args.path)}:{errors:[{text:`No loader for ${args.path}`}]};
  });
 }};
}
const withFiles=<T extends Esbuild.BuildOptions>(options:T):T=>({...options,write:false,plugins:[...(options.plugins??[]),projectFiles(options)]});
const api=()=>loadEsbuild(host) as unknown as Promise<typeof Esbuild>;
export const esbuild={
 build:async(options:Esbuild.BuildOptions)=>(await api()).build(withFiles(options)),
 context:async(options:Esbuild.BuildOptions)=>(await api()).context(withFiles(options)),
 transform:async(input:string,options?:Esbuild.TransformOptions)=>(await api()).transform(input,options),
 formatMessages:async(messages:Esbuild.PartialMessage[],options:Esbuild.FormatMessagesOptions)=>(await api()).formatMessages(messages,options),
};
