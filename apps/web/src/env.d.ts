/// <reference types="vite/client" />
interface ImportMetaEnv{readonly DREAM_SUPABASE_URL?:string;readonly DREAM_SUPABASE_ANON_KEY?:string}
interface ImportMeta{readonly env:ImportMetaEnv}
declare module 'path-browserify'{import path from 'node:path';export=path;}
