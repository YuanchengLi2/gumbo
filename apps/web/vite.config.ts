import {defineConfig,type Plugin} from 'vite';
import react from '@vitejs/plugin-react';
import {resolve} from 'node:path';
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
 * browser sandbox, which has its own tools). */
function webModules():Plugin{
 const service=resolve(__dirname,'../project-service/src').replace(/\\/g,'/');
 const swaps:Record<string,string>={'./edit-audio':project('web-edit-audio.ts'),'./web-fetch':project('web-fetch.ts'),'./workspace-environment':project('web-workspace-environment.ts')};
 return{name:'gumbo-web-modules',enforce:'pre',resolveId(source,importer){if(importer&&importer.replace(/\\/g,'/').startsWith(service)&&swaps[source])return swaps[source];return null;}};
}
/** In development the page may also reach servers on this computer (the tests' stand-in for Supabase and the gateway). */
function localServers():Plugin{return{name:'gumbo-local-servers',apply:'serve',transformIndexHtml:html=>html.replace("connect-src 'self'","connect-src 'self' http://127.0.0.1:* http://localhost:*")};}
export default defineConfig({
 base:'/app/',
 root:__dirname,
 envDir:resolve(__dirname,'../..'),
 envPrefix:['DREAM_SUPABASE_'],
 // Fast refresh for the editor's own files only: the packages also run in the project worker, which has no window.
 plugins:[webModules(),localServers(),react({exclude:[/[\/]node_modules[\/]/,/[\/]packages[\/]/]})],
 // Built-ins match whole names only: 'node:fs' must not also take 'node:fs/promises'.
 resolve:{alias:[...Object.entries({...aliases,'@renderer':resolve(__dirname,'../desktop/src/renderer')}).map(([find,replacement])=>({find,replacement})),...Object.entries(builtins).map(([name,replacement])=>({find:new RegExp(`^${name}$`),replacement}))],dedupe:['react','react-dom','remotion','@remotion/player','mediabunny']},
 optimizeDeps:{include:['react','react-dom/client','react/jsx-runtime','react/jsx-dev-runtime','zustand','lucide-react','zod','remotion','@remotion/player','buffer','path-browserify','@noble/hashes/sha2','@noble/hashes/legacy','fflate','source-map-js','mediabunny','@mediabunny/aac-encoder','@mediabunny/mp3-encoder'],exclude:['@sqlite.org/sqlite-wasm']},
 server:{port:5180,strictPort:true,headers:isolation,fs:{allow:[resolve(__dirname,'../..')]}},
 preview:{port:5181,strictPort:true,headers:isolation},
 worker:{format:'es',plugins:()=>[webModules()]},
 build:{outDir:'dist',sourcemap:true,target:'es2022'}
});
