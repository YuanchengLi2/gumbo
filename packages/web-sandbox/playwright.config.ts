import {defineConfig} from '@playwright/test';
/** Headless Chromium only: the sandbox targets Chrome and Edge, and never opens a visible window. */
export default defineConfig({testDir:'test/browser',testMatch:'*.spec.ts',timeout:600000,workers:1,reporter:'list',outputDir:'test-results/playwright',use:{browserName:'chromium',headless:true}});
