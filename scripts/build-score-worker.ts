import {build} from 'esbuild';
await build({entryPoints:['apps/project-service/src/procedural-worker.ts'],outfile:'artifacts/workers/procedural-worker.cjs',bundle:true,platform:'node',format:'cjs',target:'node24'});
console.log('Trusted audio worker built.');
