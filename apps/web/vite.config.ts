import {defineConfig,type Plugin} from 'vite';
import react from '@vitejs/plugin-react';
import {resolve} from 'node:path';
import {readdirSync,readFileSync,createReadStream,existsSync,statSync} from 'node:fs';
import {engineCsp} from '../../packages/scene-engine/src/host-html';
import {ENGINE_VERSION} from '../../packages/scene-engine/src/protocol';
import {aliases} from '../desktop/vite.shared';

/** Gumbo on the web. The editor is the desktop renderer's code (apps/desktop/src/renderer, kept in place until the last
 * desktop release ships); src/bridge answers window.dream in the browser. The project service
 * (apps/project-service) runs unchanged in a worker, with Node's built-ins pointed at browser versions (src/project).
 * Cross-origin isolation (COOP + COEP credentialless) gives SharedArrayBuffer to the synchronous file system, SQLite,
 * ffmpeg.wasm and Pyodide, while still loading creators' YouTube avatars. The site is served under /app on usegumbo.app. */
const isolation={'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'credentialless'};
const project=(path:string)=>resolve(__dirname,'src/project',path);
const node=project('shims/node.ts');
const builtins:Record<string,string>={
 'node:fs':project('fs/sync-fs.ts'),'fs':project('fs/sync-fs.ts'),'node:fs/promises':project('shims/fs-promises.ts'),'fs/promises':project('shims/fs-promises.ts'),
 'node:path':'path-browserify','path':'path-browserify','node:crypto':project('shims/crypto.ts'),'crypto':project('shims/crypto.ts'),
 'node:child_process':project('shims/child-process.ts'),'better-sqlite3':project('shims/better-sqlite3.ts'),'sqlite-vec':project('shims/sqlite-vec.ts'),
 ...Object.fromEntries(['os','zlib','util','timers/promises','stream','stream/promises','readline','module','vm','worker_threads','dns/promises','net'].flatMap(m=>[[`node:${m}`,node],[m,node]])),
};
/** Inside the project service only: modules whose desktop versions do their work another way on the web (listening mixes
 * with the export's mixer instead of an ffmpeg filter graph; web pages are read through the gateway; commands run in the
 * browser sandbox, which has its own tools; sound is analysed in a worker of its own; speech is heard in the cloud, or by Whisper in the browser; music and sound effects are composed in a web worker). */
function webModules():Plugin{
 const service=resolve(__dirname,'../project-service/src').replace(/\\/g,'/');
 const swaps:Record<string,string>={'./edit-audio':project('web-edit-audio.ts'),'./web-fetch':project('web-fetch.ts'),'./workspace-environment':project('web-workspace-environment.ts'),'./speech':project('web-speech.ts'),'./procedural-client':project('web-procedural-client.ts'),'./sound-runtime':project('web-sound-runtime.ts')};
 return{name:'gumbo-web-modules',enforce:'pre',resolveId(source,importer){if(importer&&importer.replace(/\\/g,'/').startsWith(service)&&swaps[source])return swaps[source];return null;}};
}
/** In development, and in a build made for the tests (--mode test, never deployed), the page may also reach servers on
 * this computer (the tests' stand-in for Supabase and the gateway, and the development server's reload socket). */
function localServers():Plugin{return{name:'gumbo-local-servers',apply:(_config,{command,mode})=>command==='serve'||mode!=='production',transformIndexHtml:html=>html.replace("connect-src 'self'","connect-src 'self' http://127.0.0.1:* http://localhost:* ws://localhost:*")};}
/** ONNX Runtime's WebAssembly for local Whisper (packages/web-ml), from this site at /app/ort/ rather than a CDN: the
 * pair the WebGPU build transformers.js imports loads (asyncify), served in development and copied into the build. The
 * copy Vite would bundle from transformers' own reference is left out: the app points ONNX Runtime here instead. */
function onnxRuntime():Plugin{
 const dist=resolve(__dirname,'../../node_modules/onnxruntime-web/dist'),files=()=>readdirSync(dist).filter(name=>/^ort-wasm-simd-threaded\.asyncify\.(mjs|wasm)$/.test(name));
 return{name:'gumbo-onnx-runtime',
  configureServer(server){server.middlewares.use('/app/ort/',(req,res,next)=>{const name=decodeURIComponent((req.url??'').slice(1).split('?')[0]);if(!files().includes(name))return next();
   res.setHeader('Content-Type',name.endsWith('.wasm')?'application/wasm':'text/javascript');for(const [key,value] of Object.entries(isolation))res.setHeader(key,value);createReadStream(resolve(dist,name)).pipe(res);});},
  generateBundle(_options,bundle){for(const name of files())this.emitFile({type:'asset',fileName:`ort/${name}`,source:readFileSync(resolve(dist,name))});
   for(const [key,output] of Object.entries(bundle))if(/^assets\/ort-wasm-simd-threaded.*\.wasm$/.test(output.fileName))delete bundle[key];}};
}
/** Engine scenes (the desktop's dream-engine://, served here because a sandboxed scene bypasses the service worker):
 * the runtime chunks and fonts (built by scripts/build-engine.ts), the scene page any scene or draft address opens
 * (public/engine/host.js fills it from the editor), and the picture-taker it uses for Export. The page may load code only
 * from this site ('self' names the page's address even in its sandbox) and blob: URLs, and reach nothing else. Served in
 * development, written into the build, where the hosting serves engine/host.html at every scene and draft address. */
/** Embeddable and readable by a sandboxed scene page, whose origin is opaque, so cross-origin to this site: its page
 * loads only with CORP cross-origin (the app is cross-origin isolated), and its module scripts load with CORS. */
const engineHeaders=(res:{setHeader(key:string,value:string):unknown})=>{for(const [key,value] of Object.entries({...isolation,'Cross-Origin-Resource-Policy':'cross-origin','Access-Control-Allow-Origin':'*'}))res.setHeader(key,value);};
function sceneEngine():Plugin{
 const runtime=resolve(__dirname,`../desktop/resources/staged/engine/${ENGINE_VERSION}`),capture=resolve(__dirname,'../../node_modules/modern-screenshot/dist/index.mjs');
 const page=()=>{const csp=engineCsp(["'self'",'blob:']);return`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp.replace(/"/g,'&quot;')}"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}*{box-sizing:border-box}</style><script type="module" src="/app/engine/host.js"></script></head><body><div id="root"></div></body></html>`;};
 const files=(dir:string,prefix=''):string[]=>readdirSync(resolve(dir,prefix),{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(dir,prefix+e.name+'/'):[prefix+e.name]);
 const type=(name:string)=>({js:'text/javascript',mjs:'text/javascript',css:'text/css',woff2:'font/woff2',woff:'font/woff',json:'application/json'} as Record<string,string>)[name.split('.').pop()!]??'application/octet-stream';
 return{name:'gumbo-scene-engine',
  configureServer(server){server.middlewares.use('/app/engine/',(req,res,next)=>{
   const path=decodeURIComponent((req.url??'').split('?')[0]);engineHeaders(res);
   if(/^\/app\/(scene|draft)\/[^/]+\/index\.html$/.test(path)){res.setHeader('Content-Type','text/html; charset=utf-8');res.setHeader('Cache-Control','no-store');res.end(page());return;}
   if(path==='/capture.js'){res.setHeader('Content-Type','text/javascript');createReadStream(capture).pipe(res);return;}
   const match=/^\/runtime\/(\d+)\/(.+)$/.exec(path),file=match&&resolve(runtime,'..',match[1],match[2]);
   if(file&&file.startsWith(resolve(runtime,'..'))&&existsSync(file)&&statSync(file).isFile()){res.setHeader('Content-Type',type(file));createReadStream(file).pipe(res);return;}
   next();});},
  // The built app, served as the hosting serves it (sign-in-site/vercel.json): the engine's headers, and every scene
  // and draft address answered by engine/host.html.
  configurePreviewServer(server){server.middlewares.use('/app/engine/',(req,res,next)=>{
   engineHeaders(res);if(/^\/app\/(scene|draft)\/[^/]+\/index\.html$/.test((req.url??'').split('?')[0])){res.setHeader('Content-Type','text/html; charset=utf-8');res.end(readFileSync(resolve(__dirname,'dist/engine/host.html')));return;}
   next();});},
  generateBundle(){
   for(const name of files(runtime))this.emitFile({type:'asset',fileName:`engine/runtime/${ENGINE_VERSION}/${name}`,source:readFileSync(resolve(runtime,name))});
   this.emitFile({type:'asset',fileName:'engine/capture.js',source:readFileSync(capture)});
   this.emitFile({type:'asset',fileName:'engine/host.html',source:page()});
  }};
}
/** For the tests against a build only (GUMBO_TEST_FILES=1): the repo's fixture files at /app/@fs/<path>, as the
 * development server serves them. */
function testFiles():Plugin{const repo=resolve(__dirname,'../..');return{name:'gumbo-test-files',configurePreviewServer(server){if(process.env.GUMBO_TEST_FILES!=='1')return;server.middlewares.use('/app/@fs/',(req,res,next)=>{
 const file=resolve(decodeURIComponent((req.url??'').split('?')[0]).replace(/^\//,''));if(!file.startsWith(repo)||!existsSync(file))return next();for(const [key,value] of Object.entries(isolation))res.setHeader(key,value);createReadStream(file).pipe(res);});}};}
export default defineConfig(({command})=>({
 base:'/app/',
 root:__dirname,
 envDir:resolve(__dirname,'../..'),
 envPrefix:['DREAM_SUPABASE_'],
 // The project service reads its settings from process.env as they are set at run time (the worker's process, globals.ts);
 // a build would otherwise put a fixed empty object in its place. Left as a lookup, as in development; NODE_ENV keeps its
 // own fixed value. Builds only: in development nothing is replaced, and the page's own Vite client has no process.
 define:command==='build'?{'process.env':'process.env'}:{},
 // Fast refresh for the editor's own files only: the packages also run in the project worker, which has no window.
 plugins:[webModules(),localServers(),onnxRuntime(),sceneEngine(),testFiles(),react({exclude:[/[\/]node_modules[\/]/,/[\/]packages[\/]/]})],
 // Built-ins match whole names only: 'node:fs' must not also take 'node:fs/promises'.
 resolve:{alias:[...Object.entries({...aliases,'@renderer':resolve(__dirname,'../desktop/src/renderer')}).map(([find,replacement])=>({find,replacement})),...Object.entries(builtins).map(([name,replacement])=>({find:new RegExp(`^${name}$`),replacement}))],dedupe:['react','react-dom','remotion','@remotion/player','mediabunny']},
 optimizeDeps:{include:['react','react-dom/client','react/jsx-runtime','react/jsx-dev-runtime','zustand','lucide-react','zod','remotion','@remotion/player','buffer','path-browserify','@noble/hashes/sha2','@noble/hashes/legacy','fflate','source-map-js','mediabunny','@mediabunny/aac-encoder','@mediabunny/mp3-encoder','@huggingface/transformers'],exclude:['@sqlite.org/sqlite-wasm']},
 server:{port:5180,strictPort:true,headers:isolation,fs:{allow:[resolve(__dirname,'../..')]}},
 preview:{port:5181,strictPort:true,headers:isolation},
 worker:{format:'es',plugins:()=>[webModules()]},
 build:{outDir:'dist',sourcemap:false,target:'es2022'}
}));
