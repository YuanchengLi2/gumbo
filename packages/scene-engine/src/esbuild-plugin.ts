import type {Plugin} from 'esbuild';
import {moduleName,unknownModuleMessage} from './modules';

/** Resolves bare imports to modules another chunk provides at runtime (DreamEngine.require), so the page has one
 * React, one Remotion and one three.js no matter how many chunks and scenes use them.
 * provided(name) returns the runtime module name to require, or undefined to bundle the import normally.
 * With strict, a bare import that is neither provided nor bundled fails with the list of available modules. */
export function dreamModulesPlugin(options:{provided:(name:string)=>string|undefined;strict?:boolean}):Plugin{
 return{name:'dream-modules',setup(build){
  build.onResolve({filter:/^[^./]/},args=>{
   if(args.namespace==='dream-module')return;
   const name=moduleName(args.path),target=options.provided(name);
   if(target)return{path:target,namespace:'dream-module'};
   if(options.strict&&!/^node:/.test(args.path))return{errors:[{text:unknownModuleMessage(args.path)}]};
  });
  build.onLoad({filter:/.*/,namespace:'dream-module'},args=>({contents:`module.exports=DreamEngine.require(${JSON.stringify(args.path)});`,loader:'js'}));
 }};
}
