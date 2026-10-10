/** Rebuild app bundles while reusing verified, unchanged external runtime resources. */
import {build as bundle} from 'esbuild';
import {build as buildRenderer} from 'vite';
import react from '@vitejs/plugin-react';
import {extractAll,createPackageWithOptions} from '@electron/asar';
import {mkdirSync,readFileSync,renameSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
const target=resolve(process.argv[2]??'artifacts/code-agent-package/Dream-win32-x64'),archive=join(target,'resources/app.asar'),stage=resolve('artifacts/app-package-'+Date.now());
mkdirSync(stage,{recursive:true});extractAll(archive,stage);
await bundle({entryPoints:{main:'apps/desktop/src/main/index.ts',service:'apps/project-service/src/main.ts',preload:'apps/desktop/src/preload/index.ts','procedural-worker':'apps/project-service/src/procedural-worker.ts','component-compile':'apps/desktop/src/workers/component-compile.ts'},outdir:join(stage,'.vite/build'),bundle:true,platform:'node',format:'cjs',target:'node24',tsconfig:'tsconfig.json',sourcemap:true,define:{MAIN_WINDOW_VITE_DEV_SERVER_URL:'undefined',MAIN_WINDOW_VITE_NAME:'"main_window"','process.env.NODE_ENV':'"production"'},external:['electron','better-sqlite3','sqlite-vec','ffmpeg-static','ffprobe-static','@remotion/renderer','@remotion/bundler']});
const aliases=Object.fromEntries(['timeline','footage','guardrails','contracts','config','project-db','composition','effects','procedural-media','orchestrator'].map(name=>[`@dream/${name}`,resolve(`packages/${name}/src/index.${name==='composition'?'tsx':'ts'}`)]));
await buildRenderer({configFile:false,root:resolve('apps/desktop'),base:'./',plugins:[react()],resolve:{alias:aliases,dedupe:['react','react-dom','remotion','@remotion/player']},build:{outDir:join(stage,'.vite/renderer/main_window'),emptyOutDir:true,sourcemap:true}});
const updated=join(target,'resources/app.updated.asar');await createPackageWithOptions(stage,updated,{unpackDir:'node_modules'});renameSync(updated,archive);
const report={package:target,appAsarSha256:createHash('sha256').update(readFileSync(archive)).digest('hex'),builtAt:new Date().toISOString()};writeFileSync('artifacts/app-package-refresh.json',JSON.stringify(report,null,2));console.log(report);
