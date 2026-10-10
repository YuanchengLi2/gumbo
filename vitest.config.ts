import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';
export default defineConfig({
  resolve: { alias: Object.fromEntries(['timeline','footage','guardrails','contracts','config','project-db','composition','effects','procedural-media','orchestrator','scene-engine'].map(n => [`@dream/${n}`, resolve(`packages/${n}/src/index.ts`)])) },
  test: { include: ['tests/**/*.test.ts'], environment: 'node', testTimeout: 30000 }
});
