import {defineConfig} from 'vite';
import {aliases} from './vite.shared';
export default defineConfig({resolve:{alias:aliases},build:{rollupOptions:{output:{entryFileNames:'procedural-worker.js'}}}});
