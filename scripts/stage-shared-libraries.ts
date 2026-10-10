import {cp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {spawn} from 'node:child_process';
import {starterNodePackages,starterPythonPackages} from '../apps/project-service/src/project-packages';

export async function stageSharedLibraries(){
 const root=resolve('apps/desktop/resources/staged/libraries'),runtime=resolve('apps/desktop/resources/staged/creation'),seed=resolve('artifacts/unused-shared-runtime-20261008');
 const manifest={version:1,node:starterNodePackages,python:Object.fromEntries(starterPythonPackages.map(p=>p.split('==')))};
 await mkdir(root,{recursive:true});
 const ready=join(root,'libraries.json');
 if(existsSync(ready)&&JSON.stringify(JSON.parse(await readFile(ready,'utf8')))===JSON.stringify(manifest)){await cp('apps/desktop/native/creation-host/shared-modules.cjs',join(root,'shared-modules.cjs'));return;}
 const run=(exe:string,args:string[])=>new Promise<void>((ok,fail)=>{const child=spawn(exe,args,{cwd:root,windowsHide:true,stdio:'inherit'});child.on('error',fail);child.on('exit',code=>code===0?ok():fail(Error('Shared editing libraries could not be prepared.')));});
 const seedManifest=existsSync(join(seed,'libraries.json'))?JSON.parse(await readFile(join(seed,'libraries.json'),'utf8')):undefined;
 if(seedManifest&&Object.entries(manifest.node).every(([name,version])=>seedManifest.node[name]===version)&&Object.entries(manifest.python).every(([name,version])=>seedManifest.python[name]===version)){
  await cp(join(seed,'libraries'),root,{recursive:true});
  await cp(join(seed,'python/Lib/site-packages'),join(root,'python'),{recursive:true});
 }else{
  await writeFile(join(root,'package.json'),JSON.stringify({name:'dream-editing-libraries',private:true,dependencies:manifest.node},null,2));
  await run(join(runtime,'node/node.exe'),[join(runtime,'node/node_modules/npm/bin/npm-cli.js'),'install','--no-audit','--no-fund']);
  await run(join(runtime,'python/python.exe'),['-m','pip','install','--target',join(root,'python'),...starterPythonPackages]);
 }
 await cp('apps/desktop/native/creation-host/shared-modules.cjs',join(root,'shared-modules.cjs'));
 await writeFile(ready,JSON.stringify(manifest,null,2));
 console.log('Shared editing libraries staged. New projects require no starter downloads.');
}
if(process.argv[1]?.replaceAll('\\','/').endsWith('/stage-shared-libraries.ts'))await stageSharedLibraries();
