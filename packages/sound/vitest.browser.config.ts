import {defineConfig} from 'vitest/config';
/** The web's sound analysis in headless Edge: the real worker, ONNX Runtime's WebAssembly and the models (downloaded once
 * into a browser profile in the temp folder). npx vitest run --config packages/sound/vitest.browser.config.ts */
export default defineConfig({test:{root:__dirname,include:['test/**/*.browser.test.ts'],environment:'node',testTimeout:600_000,hookTimeout:300_000,fileParallelism:false}});
