import {defineConfig} from 'vitest/config';
import {resolve} from 'node:path';
// Unit tests; `pnpm test:browser` (vitest.browser.config.ts) transcribes speech fixtures in headless Chromium.
export default defineConfig({
 resolve:{alias:{'@dream/footage':resolve(__dirname,'../footage/src/index.ts')}},
 test:{root:__dirname,include:['test/**/*.test.ts'],exclude:['test/**/*.browser.test.ts'],environment:'node'},
});
