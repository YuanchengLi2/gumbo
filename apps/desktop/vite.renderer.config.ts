import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {aliases} from './vite.shared';

export default defineConfig({
 base:'./',
 plugins:[react()],
 resolve:{alias:aliases,dedupe:['react','react-dom','remotion','@remotion/player']},
 // Prepare the renderer while Forge builds the desktop processes, so the
 // first window does not wait on dependency discovery and module transforms.
 optimizeDeps:{include:['react','react-dom/client','react/jsx-runtime','react/jsx-dev-runtime','zustand','lucide-react','zod','remotion','@remotion/player']},
 server:{warmup:{clientFiles:['./src/renderer/main.tsx']}},
 build:{sourcemap:true}
});
