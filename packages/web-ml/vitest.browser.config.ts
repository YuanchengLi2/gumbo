import {defineConfig} from 'vitest/config';
/** Headless Chromium transcribing real speech; models download once into a browser profile in the temp folder. */
export default defineConfig({test:{root:__dirname,include:['test/**/*.browser.test.ts'],environment:'node',testTimeout:1_800_000,hookTimeout:600_000,fileParallelism:false}});
