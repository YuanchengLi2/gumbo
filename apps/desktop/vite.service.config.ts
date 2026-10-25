import {defineConfig} from 'vite';import {aliases} from './vite.shared';
export default defineConfig({resolve:{alias:aliases},build:{rollupOptions:{external:['electron','better-sqlite3','sqlite-vec','ffmpeg-static','ffprobe-static','onnxruntime-node'],output:{entryFileNames:'service.js'}}}});
