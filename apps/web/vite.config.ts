import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {resolve} from 'node:path';
import {aliases} from '../desktop/vite.shared';

/** Gumbo on the web. The editor is the desktop renderer's code (apps/desktop/src/renderer, kept in place until the last
 * desktop release ships); src/bridge answers window.dream in the browser. Cross-origin isolation (COOP + COEP
 * credentialless) gives SharedArrayBuffer to ffmpeg.wasm, Pyodide and SQLite's OPFS storage, while still loading
 * creators' YouTube avatars. The site is served under /app on usegumbo.app. */
const isolation={'Cross-Origin-Opener-Policy':'same-origin','Cross-Origin-Embedder-Policy':'credentialless'};
export default defineConfig({
 base:'/app/',
 root:__dirname,
 envDir:resolve(__dirname,'../..'),
 envPrefix:['DREAM_SUPABASE_'],
 plugins:[react()],
 resolve:{alias:{...aliases,'@renderer':resolve(__dirname,'../desktop/src/renderer')},dedupe:['react','react-dom','remotion','@remotion/player']},
 optimizeDeps:{include:['react','react-dom/client','react/jsx-runtime','react/jsx-dev-runtime','zustand','lucide-react','zod','remotion','@remotion/player']},
 server:{port:5180,strictPort:true,headers:isolation,fs:{allow:[resolve(__dirname,'../..')]}},
 preview:{port:5181,strictPort:true,headers:isolation},
 worker:{format:'es'},
 build:{outDir:'dist',sourcemap:true,target:'es2022'}
});
