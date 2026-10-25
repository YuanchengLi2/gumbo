import {defineConfig} from '@playwright/test';
/** Gumbo for Chrome end to end: headless Chromium with the unpacked extension (build it first), a stand-in gateway,
 * local test pages. No window opens.
 *   pnpm --filter @dream/extension build && pnpm --filter @dream/extension test:e2e */
export default defineConfig({testDir:'./e2e',testMatch:'*.spec.ts',workers:2,reporter:'list',timeout:60_000,fullyParallel:false,use:{trace:'off'}});
