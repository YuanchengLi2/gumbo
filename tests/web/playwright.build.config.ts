import {defineConfig} from '@playwright/test';
/** The web tests against the built app, served by vite preview as the hosting serves it (headers, scene addresses).
 * It is built with --mode test: the production build with the tests' local stand-ins for Supabase and the gateway
 * allowed, which a deployed build never has. npx playwright test -c tests/web/playwright.build.config.ts */
export default defineConfig({testDir:'.',testMatch:'*.spec.ts',workers:1,reporter:'list',timeout:120_000,
 use:{channel:'msedge',headless:true,baseURL:'http://localhost:5181'},
 webServer:{command:'pnpm --filter @dream/web exec vite build --mode test && pnpm --filter @dream/web preview',url:'http://localhost:5181/app/',reuseExistingServer:false,timeout:300_000,env:{GUMBO_TEST_FILES:'1'}}});
