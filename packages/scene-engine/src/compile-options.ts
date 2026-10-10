import type {BuildOptions,Plugin} from 'esbuild';
import {MODULES} from './modules';
import {dreamModulesPlugin} from './esbuild-plugin';

/** esbuild settings for one scene bundle. Engine modules come from the shared runtime; any other package the agent
 * installed is bundled into the scene. The bundle registers its module as "scene" for the host to mount. */
export function sceneBuildOptions(entry:string,options:{plugins?:Plugin[];sourceRoot?:string}={}):BuildOptions&{metafile:true}{
 return{
  entryPoints:[entry],bundle:true,write:false,format:'iife',globalName:'__dreamScene',platform:'browser',target:'chrome130',
  jsx:'automatic',sourcemap:'external',sourcesContent:true,metafile:true,minify:false,legalComments:'none',logLevel:'silent',
  define:{'process.env.NODE_ENV':'"production"'},
  footer:{js:'DreamEngine.define("scene",function(){return __dreamScene;});'},
  ...(options.sourceRoot?{sourceRoot:options.sourceRoot}:{}),
  plugins:[dreamModulesPlugin({provided:name=>MODULES[name]?name:undefined}),...options.plugins??[]],
 };
}
