import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
import {existsSync,readFileSync,cpSync,mkdirSync,readdirSync,rmSync} from 'node:fs';
export function copyRuntimeDependencies(destination:string){
 const appRequire=createRequire(join(__dirname,'package.json'));
 const copied=new Set<string>(),rootVersions=new Map<string,string>();
 function locate(name:string,require:NodeJS.Require){
  try{return dirname(require.resolve(`${name}/package.json`));}catch{}
  // Binary-only packages may export just a DLL/dylib subpath and no root entry.
  // Locate their installed manifest through Node's search roots instead of
  // mistaking an exports restriction for an absent optional dependency.
  for(const root of require.resolve.paths(name)??[]){const candidate=join(root,name),manifest=join(candidate,'package.json');if(existsSync(manifest)&&JSON.parse(readFileSync(manifest,'utf8')).name===name)return candidate;}
  let path=dirname(require.resolve(name));
  for(;;){const manifest=join(path,'package.json');if(existsSync(manifest)&&JSON.parse(readFileSync(manifest,'utf8')).name===name)return path;const parent=dirname(path);if(parent===path)throw new Error(`Cannot locate runtime package ${name}`);path=parent;}
 }
 function copy(name:string,require:NodeJS.Require,parentDestination:string,optional=false,ancestors=new Set<string>()){
  let source:string;try{source=locate(name,require);}catch(error){if(optional)return;throw error;}
  const pkg=JSON.parse(readFileSync(join(source,'package.json'),'utf8'));
  const allowed=(list:string[]|undefined,value:string)=>!list||(!list.includes(`!${value}`)&&(!list.some(v=>!v.startsWith('!'))||list.includes(value)));
  if(!allowed(pkg.os,process.platform)||!allowed(pkg.cpu,process.arch))return;
  const identity=`${name}@${pkg.version}`;if(ancestors.has(identity))return;
  const rootVersion=rootVersions.get(name);const target=join(rootVersion&&rootVersion!==pkg.version?parentDestination:destination,'node_modules',name);
  if(copied.has(target))return;copied.add(target);if(!rootVersion)rootVersions.set(name,pkg.version);
  mkdirSync(dirname(target),{recursive:true});cpSync(source,target,{recursive:true,dereference:true,filter:path=>!path.startsWith(join(source,'node_modules'))});
  const nested=createRequire(join(source,'package.json')),chain=new Set([...ancestors,identity]);
  for(const dependency of Object.keys(pkg.dependencies??{}))copy(dependency,nested,target,false,chain);
  for(const dependency of Object.keys(pkg.optionalDependencies??{}))copy(dependency,nested,target,true,chain);
  for(const dependency of Object.keys(pkg.peerDependencies??{}))copy(dependency,nested,target,!!pkg.peerDependenciesMeta?.[dependency]?.optional,chain);
 }
 // ffmpeg-static and ffprobe-static are not shipped: the app uses staged/media-runtime once installed.
 for(const dependency of ['better-sqlite3','sqlite-vec','@remotion/renderer','onnxruntime-node'])copy(dependency,appRequire,destination);
 // ONNX Runtime (the sound analysis) ships every platform's build and its GPU libraries (288 MB); the app runs it on the
 // CPU, so only this platform's runtime stays (28 MB on Windows).
 const ort=join(destination,'node_modules','onnxruntime-node','bin');
 if(existsSync(ort))for(const napi of readdirSync(ort))for(const platform of readdirSync(join(ort,napi))){
  const folder=join(ort,napi,platform);if(platform!==process.platform){rmSync(folder,{recursive:true,force:true});continue;}
  for(const arch of readdirSync(folder)){if(arch!==process.arch){rmSync(join(folder,arch),{recursive:true,force:true});continue;}for(const name of ['DirectML.dll','dxcompiler.dll','dxil.dll'])rmSync(join(folder,arch,name),{force:true});}
 }
}
