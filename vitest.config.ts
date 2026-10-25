import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
export default defineConfig({
  resolve: { alias: Object.fromEntries(['timeline','footage','guardrails','contracts','config','project-db','composition','effects','procedural-media','agent','scene-engine','compositor'].map(n => [`@dream/${n}`, resolve(`packages/${n}/src/index.ts`)])) },
  // Commands run at normal priority in tests: below normal (the app's setting) waits for a CPU the parallel suite keeps busy.
  test: { include: ['tests/**/*.test.ts'], environment: 'node', testTimeout: 30000, globalSetup: ['tests/setup/temp-run.ts'], env: { DREAM_COMMAND_PRIORITY: 'normal' } }
});
