import {defineConfig} from '@playwright/test';
/** Gumbo on the web, headless in the computer's own Microsoft Edge (no browser download): the dev server on 5180.
 * npx playwright test -c tests/web/playwright.config.ts */
export default defineConfig({testDir:'.',testMatch:'*.spec.ts',workers:1,reporter:'list',timeout:120_000,
 use:{channel:'msedge',headless:true,baseURL:'http://localhost:5180'},
 webServer:{command:'pnpm --filter @dream/web dev',url:'http://localhost:5180/app/',reuseExistingServer:true,timeout:120_000}});
