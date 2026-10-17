import {createRequire} from 'node:module';
import {join,dirname,relative,isAbsolute} from 'node:path';
import {mkdirSync,realpathSync} from 'node:fs';
import {workspacePath} from '../../../packages/project-db/src/workspace-store';

/** Bundles browser source only. Authored code/config/plugins never run in the host. */
export async function bundleScene(root:string,libraries:string,input:{entry:string;output:string},signal:AbortSignal){
 signal.throwIfAborted();const entry=workspacePath(root,input.entry),output=workspacePath(root,input.output);
 if(!input.output.replaceAll('\\','/').startsWith('output/'))throw new Error('Bundle output must be under output/.');
 const compiler=createRequire(join(libraries,'package.json'))('esbuild') as typeof import('esbuild');
 mkdirSync(dirname(output),{recursive:true});
 const roots=[realpathSync(root),realpathSync(libraries)],allowed=(path:string)=>roots.some(base=>{const rel=relative(base,path);return rel!== '..'&&!rel.startsWith('..\\')&&!rel.startsWith('../')&&!isAbsolute(rel);});
 const context=await compiler.context({entryPoints:[entry],outfile:output,absWorkingDir:root,bundle:true,format:'iife',platform:'browser',nodePaths:[join(libraries,'node_modules')],tsconfigRaw:{compilerOptions:{jsx:'react-jsx'}},loader:{'.png':'dataurl','.jpg':'dataurl','.jpeg':'dataurl','.svg':'dataurl','.woff':'dataurl','.woff2':'dataurl'},logLevel:'silent',plugins:[{name:'project-files',setup(build){build.onLoad({filter:/.*/},args=>{if(!allowed(realpathSync(args.path)))throw new Error('Import scene files from this project or Gumbo editing libraries.');return undefined;});}}]});
 const abort=()=>{void context.cancel();};signal.addEventListener('abort',abort,{once:true});
 try{signal.throwIfAborted();await context.rebuild();signal.throwIfAborted();return{path:input.output,ready:true};}finally{signal.removeEventListener('abort',abort);await context.dispose();}
}
