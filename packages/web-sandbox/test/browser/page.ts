import {SandboxClient} from '../../src/client';

/** The test page: one client on the bundled worker, with the wasm parts served from this origin as the web app would. */
const client=new SandboxClient({
 createWorker:()=>new Worker('/dist/sandbox.worker.js',{type:'module'}),
 graceMs:3000,
 options:{workspace:'/workspace',assets:{pyodide:'/assets/pyodide/',ffmpeg:'/assets/ffmpeg/',ffmpegMt:'/assets/ffmpeg-mt/',esbuildWasm:'/assets/esbuild/esbuild.wasm',esbuildModule:'/assets/esbuild/esm/browser.min.js'}}
});
(globalThis as {client?:SandboxClient}).client=client;
document.getElementById('state')!.textContent='ready';
