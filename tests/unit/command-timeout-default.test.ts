import {it,expect,vi,afterEach} from 'vitest';

/** run_command's time limit when Roux names none: three minutes in the browser (one command at a time there, and a stuck
 * one holds the rest), ten on the desktop. */
afterEach(()=>{delete process.env.DREAM_RUNTIME;vi.resetModules();});
it('defaults run_command to three minutes in the browser and ten on the desktop',async()=>{
 process.env.DREAM_RUNTIME='browser';vi.resetModules();
 const web=await import('../../packages/orchestrator/src/code-tools');
 expect((web.parseCodeTool('run_command',{command:'ls'}) as any).timeoutMs).toBe(180_000);
 delete process.env.DREAM_RUNTIME;vi.resetModules();
 const desktop=await import('../../packages/orchestrator/src/code-tools');
 expect((desktop.parseCodeTool('run_command',{command:'ls'}) as any).timeoutMs).toBe(600_000);
});
