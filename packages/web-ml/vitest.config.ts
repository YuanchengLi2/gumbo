import {defineConfig} from 'vitest/config';
import {resolve} from 'node:path';
// `pnpm test` runs the unit tests; `pnpm test:browser` transcribes a speech fixture in headless Chromium (downloads models once).
const browser=process.env.WEB_ML_BROWSER==='1';
export default defineConfig({
 resolve:{alias:{'@dream/footage':resolve(__dirname,'../footage/src/index.ts')}},
 test:{root:__dirname,include:[browser?'test/**/*.browser.test.ts':'test/**/*.test.ts'],exclude:browser?[]:['test/**/*.browser.test.ts'],environment:'node',testTimeout:browser?900_000:30_000,hookTimeout:browser?900_000:30_000},
});
