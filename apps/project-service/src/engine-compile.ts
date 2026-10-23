import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {existsSync,readdirSync,readFileSync,realpathSync,statSync} from 'node:fs';
import {extname,join,relative,resolve,sep} from 'node:path';
import type {Plugin} from 'esbuild';
import {sceneBuildOptions} from '../../../packages/scene-engine/src/compile-options';
import {chunksFor,unknownModuleMessage,MODULES,moduleName} from '../../../packages/scene-engine/src/modules';
import {ENGINE_VERSION} from '../../../packages/scene-engine/src/protocol';

export type CompileError={file:string;line:number;column:number;text:string};
export type CompiledScene={bundle:string;map:string;chunks:string[];inputs:string[];resources:Record<string,string>;assetRefs:string[];errors:CompileError[];hash:string;version:number};
export const RESOURCE_FILE_LIMIT=24*1024*1024,RESOURCE_TOTAL_LIMIT=96*1024*1024;
const SCENE_EXTENSIONS=new Set(['.tsx','.ts','.jsx','.js','.mjs']);
export const isEngineScene=(path:string)=>SCENE_EXTENSIONS.has(extname(path).toLowerCase());
// File types a scene may import directly; the import becomes the file's URL (resources are served by content hash).
const BINARY=/\.(png|jpe?g|gif|webp|avif|svg|bmp|ico|mp4|webm|mov|mp3|wav|ogg|m4a|flac|woff2?|ttf|otf|glb|gltf|bin|hdr|ktx2|json5)$/i;

let esbuild:typeof import('esbuild')|undefined;
/** The same esbuild the scene bundler uses: the packaged shared libraries when present, else the workspace copy. */
export function loadEsbuild():typeof import('esbuild'){
 if(esbuild)return esbuild;const libraries=process.env.DREAM_SHARED_LIBRARIES;
 esbuild=(libraries&&existsSync(join(libraries,'package.json'))?createRequire(join(libraries,'package.json')):createRequire(join(process.cwd(),'package.json')))('esbuild') as typeof import('esbuild');
 return esbuild;
}
const toPosix=(path:string)=>path.split(sep).join('/');
function walk(root:string,dir:string,out:string[]=[]){if(!existsSync(join(root,dir)))return out;for(const entry of readdirSync(join(root,dir),{withFileTypes:true})){if(entry.isSymbolicLink())continue;const path=dir?dir+'/'+entry.name:entry.name;if(entry.isDirectory())walk(root,path,out);else if(entry.isFile())out.push(path);}return out;}
const sha256=(bytes:Buffer|string)=>createHash('sha256').update(bytes).digest('hex');

/** Compiles one scene entry from the workspace into a single bundle for the engine runtime. It never executes authored
 * code. Engine modules come from the runtime; installed packages (Workspace/node_modules) are bundled in. */
export async function compileScene(root:string,options:{entry:string;mode?:'publish'|'draft'}):Promise<CompiledScene>{
 const compiler=loadEsbuild(),workspace=realpathSync(root),entry=resolve(workspace,options.entry);
 const allowed=[join(workspace,'src'),join(workspace,'resources'),join(workspace,'node_modules')].map(p=>existsSync(p)?realpathSync(p):p);
 const inside=(path:string)=>allowed.some(base=>path===base||path.startsWith(base+sep));
 const imported=new Map<string,string>();
 const workspaceFiles:Plugin={name:'workspace-files',setup(build){
  // Imports of packages that are neither provided by the engine nor installed get the actionable message.
  build.onResolve({filter:/^[^./]/},async args=>{
   if(args.pluginData?.dreamResolving||args.namespace==='dream-module'||MODULES[moduleName(args.path)]||/^node:/.test(args.path))return;
   const result=await build.resolve(args.path,{kind:args.kind,resolveDir:args.resolveDir,importer:args.importer,pluginData:{dreamResolving:true}});
   if(result.errors.length)return{errors:[{text:unknownModuleMessage(args.path)}]};
   return result;
  });
  build.onLoad({filter:BINARY},args=>{
   const real=realpathSync(args.path);if(!inside(real))return{errors:[{text:`Scenes can only use files in src/, resources/ and installed packages.`}]};
   const rel=toPosix(relative(workspace,real)),key=rel.startsWith('resources/')?rel.slice('resources/'.length):'@'+rel;imported.set(key,rel);
   // The file's URL relative to the scene document, or the blob URL its host gives on the web (runtime/api/files.ts).
   const url=JSON.stringify('files/'+key.split('/').map(encodeURIComponent).join('/'));
   return{contents:`module.exports=(globalThis.__dreamUrls||{})[${url}]||${url};`,loader:'js'};
  });
  build.onLoad({filter:/\.(tsx?|jsx?|mjs|cjs|css|json)$/},args=>{
   if(args.namespace!=='file')return;const real=realpathSync(args.path);
   if(!inside(real))return{errors:[{text:`Scenes can only import files from src/, resources/ and installed packages (${toPosix(relative(workspace,real))} is outside them).`}]};
   return undefined;
  });
 }};
 let result:import('esbuild').BuildResult&{metafile?:import('esbuild').Metafile;outputFiles?:import('esbuild').OutputFile[]};
 try{result=await compiler.build({...sceneBuildOptions(entry,{plugins:[workspaceFiles]}),absWorkingDir:workspace,outfile:join(workspace,'.cache','scene.js'),loader:{'.css':'empty'}});}
 catch(error){const failure=error as {errors?:import('esbuild').Message[]};const errors=(failure.errors??[{text:String((error as Error).message),location:null} as any]).map((e:import('esbuild').Message)=>({file:e.location?toPosix(relative(workspace,resolve(workspace,e.location.file))):options.entry,line:e.location?.line??1,column:(e.location?.column??0)+1,text:e.text}));return{bundle:'',map:'',chunks:['core'],inputs:[],resources:{},assetRefs:[],errors,hash:'',version:ENGINE_VERSION};}
 const bundle=result.outputFiles!.find(f=>f.path.endsWith('.js'))!.text,map=result.outputFiles!.find(f=>f.path.endsWith('.map'))?.text??'';
 const inputs=Object.keys(result.metafile!.inputs).filter(p=>!p.startsWith('dream-module:')).map(p=>toPosix(p));
 const imports=Object.values(result.metafile!.inputs).flatMap(input=>input.imports.map(i=>i.path));
 // Literal names in authored sources: resources the scene asks for and project assets it shows.
 const sources=inputs.filter(p=>p.startsWith('src/')).map(p=>{try{return readFileSync(join(workspace,p),'utf8');}catch{return'';}}).join('\n');
 const assetRefs=[...new Set([...sources.matchAll(/\b(?:useAsset|asset)\(\s*['"`]([^'"`]+)['"`]\s*\)/g)].map(m=>m[1]))];
 const usesThree=/from\s*['"]@dream\/engine['"]/.test(sources)&&/\b(Scene3D|useTexture)\b/.test(sources);
 // Every file under resources/ is available (scenes may choose files by computed names), plus files imported from src/.
 const resources:Record<string,string>={};let total=0;
 for(const rel of walk(workspace,'resources')){const size=statSync(join(workspace,rel)).size;if(size>RESOURCE_FILE_LIMIT)throw new Error(`${rel} is larger than 24 MB; resources must be smaller.`);total+=size;resources[rel.slice('resources/'.length)]=rel;}
 for(const [key,rel] of imported){if(!resources[key]){const size=statSync(join(workspace,rel)).size;if(size>RESOURCE_FILE_LIMIT)throw new Error(`${rel} is larger than 24 MB.`);total+=size;resources[key]=rel;}}
 if(total>RESOURCE_TOTAL_LIMIT)throw new Error('resources/ holds more than 96 MB; remove unused files.');
 const hash=sha256(JSON.stringify({bundle,resources:Object.fromEntries(Object.entries(resources).map(([key,rel])=>[key,sha256(readFileSync(join(workspace,rel)))])),version:ENGINE_VERSION}));
 return{bundle,map,chunks:chunksFor(imports,usesThree),inputs,resources,assetRefs,errors:[],hash,version:ENGINE_VERSION};
}

/** Maps a runtime stack (bundle line:column) back to authored files using the scene's source map. */
export async function mapStack(stack:string,mapText:string):Promise<string|undefined>{
 if(!stack||!mapText)return;
 const {SourceMapConsumer}=await import('source-map-js');const consumer=new SourceMapConsumer(JSON.parse(mapText));
 for(const match of stack.matchAll(/bundle\.js(?:\?[^:]*)?:(\d+):(\d+)/g)){const position=consumer.originalPositionFor({line:Number(match[1]),column:Number(match[2])-1});if(position.source&&!/node_modules|dream-module/.test(position.source))return`${position.source.replace(/^(\.\.\/)+/,'')}:${position.line}:${(position.column??0)+1}`;}
}
