import {describe,it,expect} from 'vitest';
import {MemoryFS} from '../src/fs/memory';
import {Sandbox} from '../src/sandbox';
import type {Command} from '../src/shell/types';
import {decode} from '../src/fs/util';

const make=(options:ConstructorParameters<typeof Sandbox>[1]={})=>new Sandbox(new MemoryFS({'workspace/clip.txt':'frames\n'}),options);
describe('run_command semantics',()=>{
 it('returns output, exit code and a complete or failed status',async()=>{
  const sandbox=make();
  const ok=await sandbox.runCommand({command:'cat clip.txt; echo err >&2'});
  expect(ok.process).toMatchObject({status:'complete',exitCode:0,output:'frames\nerr\n',isolation:'browser'});
  const bad=await sandbox.runCommand({command:'grep missing clip.txt'});expect(bad.process).toMatchObject({status:'failed',exitCode:1});
 });
 it('starts in cwd under the workspace and refuses a missing one',async()=>{
  const sandbox=make();await sandbox.runCommand({command:'mkdir -p a/b'});
  expect((await sandbox.runCommand({command:'pwd',cwd:'a/b'})).process.output).toBe('/workspace/a/b\n');
  const r=await sandbox.runCommand({command:'pwd',cwd:'nope'});expect(r.process.status).toBe('failed');expect(r.process.output).toContain('No such directory');
 });
 it('gives commands a home, a temp folder and the workspace in the environment',async()=>{
  const r=await make().runCommand({command:'echo $HOME $TMPDIR $DREAM_WORKSPACE; test -d "$TMPDIR" && echo tmp-ok'});
  expect(r.process.output).toBe('/workspace/.cache /workspace/.cache/tmp /workspace\ntmp-ok\n');
 });
 it('keeps only the end of long output',async()=>{
  const r=await make({maxOutputChars:100}).runCommand({command:'seq 1 1000'});
  expect(r.process.output.length).toBe(100);expect(r.process.output.endsWith('999\n1000\n')).toBe(true);
 });
 it('writes a full log when given a log folder',async()=>{
  const fs=new MemoryFS();const sandbox=new Sandbox(fs,{logDir:'/logs',maxOutputChars:10});
  const r=await sandbox.runCommand({command:'seq 1 50'}) as {process:import('../src/sandbox').ProcessResult};expect(r.process.logPath).toBe(`/logs/${r.process.id}.log`);
  expect(decode(fs.readFile(r.process.logPath)).split('\n')).toHaveLength(51);
 });
 it('cancels a command that runs past its time limit and says why',async()=>{
  const r=await make().runCommand({command:'echo start; sleep 10; echo never',timeoutMs:150}) as {process:import('../src/sandbox').ProcessResult};
  expect(r.process.status).toBe('cancelled');expect(r.process.exitCode).toBeNull();
  expect(r.process.output).toMatch(/^start\n\nCancelled after \d+s: it ran past its 0s time limit/);
 });
 it('stops a busy shell loop too, because the shell yields',async()=>{
  const r=await make().runCommand({command:'while true; do :; done',timeoutMs:300});expect(r.process.status).toBe('cancelled');
 });
 it('moves a long command to the background with a processId, then waits again or stops it',async()=>{
  const sandbox=make();
  const first=await sandbox.runCommand({command:'echo going; sleep 0.3; echo finished'},50);
  expect(first.process.status).toBe('running');expect(first.process.output).toBe('going\n');expect(first.note).toMatch(/processId "p\w+"/);
  const again=await sandbox.runCommand({processId:first.process.id},5000);expect(again.process).toMatchObject({status:'complete',output:'going\nfinished\n'});
  const slow=await sandbox.runCommand({command:'sleep 10'},20);
  const stopped=await sandbox.runCommand({processId:slow.process.id,stop:true});expect(stopped.process.status).toBe('cancelled');expect(stopped.note).toBe('Stopped.');
  await expect(sandbox.runCommand({processId:'nope'})).rejects.toThrow('No command with that processId is running.');
 });
 it('runs commands side by side without sharing their shells',async()=>{
  const sandbox=make();
  const [a,b]=await Promise.all([sandbox.runCommand({command:'x=1; sleep 0.05; echo a$x'}),sandbox.runCommand({command:'x=2; echo b$x'})]);
  expect(a.process.output).toBe('a1\n');expect(b.process.output).toBe('b2\n');
 });
 it('stops a command whose programs use more memory than allowed',async()=>{
  let held=0;
  const hog:Command=async ctx=>{ctx.host.reportMemory('hog',()=>held);held=2**31;await new Promise(r=>setTimeout(r,3000));return 0;};
  const r=await make({memoryLimitBytes:2**30,programs:{hog}}).runCommand({command:'echo before; hog'});
  expect(r.process.status).toBe('failed');expect(r.process.output).toMatch(/before\n\nStopped: this command used all 1\.0 GB of memory/);
 });
 it('names what is available when a program is missing',async()=>{
  const sandbox=make({programs:{python3:async ctx=>{await ctx.out('py\n');return 0;}}});
  const r=await sandbox.runCommand({command:'ffplay x'});expect(r.process.output).toContain('ffplay cannot play');
  const s=await sandbox.runCommand({command:'nosuch'});expect(s.process.output).toMatch(/available: .*python3/);expect(sandbox.commands()).toContain('python3');
 });
});
