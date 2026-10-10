import {build} from 'esbuild';
import {resolve,join} from 'node:path';
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {spawn} from 'node:child_process';
import {VisualRenderResultSchema,type VisualRenderer} from '@dream/contracts';
let prepared:Promise<void>|undefined;
const folder=resolve('artifacts/sandbox-acceptance');
export const visualTestRenderer:VisualRenderer=async(request,signal)=>{
 prepared??=(async()=>{await mkdir(folder,{recursive:true});for(const [entry,name] of [['tests/fixtures/visual-render-main.ts','render.cjs'],['apps/desktop/src/workers/component-compile.ts','component-compile.cjs']])await build({entryPoints:[entry],outfile:join(folder,name),bundle:true,format:'cjs',platform:'node',external:['electron']});})();await prepared;signal.throwIfAborted();
 const id=randomUUID(),input=join(folder,`${id}.request.json`),output=join(folder,`${id}.result.json`);await writeFile(input,JSON.stringify(request));
 const env={...process.env};delete env.ELECTRON_RUN_AS_NODE;const child=spawn(createRequire(import.meta.url)('electron'),[join(folder,'render.cjs'),input,output],{windowsHide:true,env,stdio:['ignore','pipe','pipe']});let diagnostic='';child.stderr.on('data',chunk=>{diagnostic=(diagnostic+chunk.toString()).slice(-4000);});
 const abort=()=>child.kill();signal.addEventListener('abort',abort,{once:true});try{await new Promise<void>((resolve,reject)=>{child.once('error',reject);child.once('exit',code=>code===0?resolve():reject(new Error(diagnostic||'Visual renderer stopped.')));});signal.throwIfAborted();return VisualRenderResultSchema.parse(JSON.parse(await readFile(output,'utf8')));}finally{signal.removeEventListener('abort',abort);}
};
