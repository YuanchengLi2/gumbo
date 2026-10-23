import {describe,it,expect,afterEach} from 'vitest';
import {SandboxClient} from '../src/client';
import {serveSandbox} from '../src/serve';
import {MemoryFS} from '../src/fs/memory';
import type {Command} from '../src/shell/types';

/** The worker, in this thread: serveSandbox answers through globalThis.postMessage/onmessage as it would in a worker.
 * `deaf` makes it ignore messages after a start and `mute` keeps it from answering, as a worker busy in a blocking
 * program would. */
class FakeWorker{
 onmessage:((e:{data:unknown})=>void)|null=null;onerror:((e:unknown)=>void)|null=null;terminated=false;deaf=false;mute=false;
 private scope=globalThis as unknown as {postMessage?:(m:unknown)=>void;onmessage?:((e:{data:unknown})=>void)|null};
 constructor(programs:Record<string,Command>){
  this.scope.postMessage=m=>setTimeout(()=>{if(!this.terminated&&!this.mute)this.onmessage?.({data:structuredClone(m)});},0);
  serveSandbox(new MemoryFS(),{programs});
 }
 postMessage(m:{type:string}){if(this.terminated||(this.deaf&&m.type!=='init'))return;const handler=this.scope.onmessage;setTimeout(()=>handler?.({data:structuredClone(m)}),0);}
 terminate(){this.terminated=true;}
}
const workers:FakeWorker[]=[];
const client=(programs:Record<string,Command>={})=>new SandboxClient({createWorker:()=>{const w=new FakeWorker(programs);workers.push(w);return w as unknown as Worker;},graceMs:100});
afterEach(()=>{workers.length=0;});
describe('SandboxClient',()=>{
 it('runs commands and reports run_command results',async()=>{
  const c=client(),init=await c.start();expect(init.commands).toContain('grep');
  const r=await c.runCommand({command:'echo hi; exit 3'});expect(r.process).toMatchObject({status:'failed',exitCode:3,output:'hi\n'});
  await c.writeFile('notes.txt','abc');expect((await c.runCommand({command:'cat notes.txt'})).process.output).toBe('abc');
 });
 it('streams output and keeps a running command in the background',async()=>{
  const c=client(),seen:string[]=[];
  const {id,done}=await c.run({command:'echo one; sleep 0.2; echo two'},t=>seen.push(t));
  const early=await c.wait(id,50);expect(early).toMatchObject({status:'running',output:'one\n'});
  expect((await done).output).toBe('one\ntwo\n');expect(seen.join('')).toBe('one\ntwo\n');
  const later=await c.runCommand({command:'sleep 5'},30);expect(later.note).toMatch(/processId "p\w+"/);
  const stopped=await c.runCommand({processId:later.process.id,stop:true});expect(stopped.process.status).toBe('cancelled');
 });
 it('runs as the desktop ProcessRunner, stopping on abort',async()=>{
  const c=client(),controller=new AbortController(),out:string[]=[];
  const pending=c.runner()({id:'call1',command:'echo start; sleep 5',timeoutMs:60000},controller.signal,t=>out.push(t));
  setTimeout(()=>controller.abort('the user stopped the request'),100);
  const r=await pending;expect(r.id).toBe('call1');expect(r.status).toBe('cancelled');expect(r.output).toContain('the user stopped the request');expect(out.join('')).toContain('start');
 });
 it('restarts a worker that does not answer a stop, and the next command runs in a new one',async()=>{
  const c=client({hold:async()=>{await new Promise(r=>setTimeout(r,60000));return 0;}});await c.start();
  const {id,done}=await c.run({command:'echo before; hold',timeoutMs:60000});
  await new Promise(r=>setTimeout(r,50));workers[0].deaf=true;
  void c.stop(id);const r=await done;
  expect(r.status).toBe('cancelled');expect(r.output).toMatch(/before\n\nCancelled after \d+s: Stopped/);expect(c.restarts).toBe(1);expect(workers[0].terminated).toBe(true);
  expect((await c.runCommand({command:'echo again'})).process.output).toBe('again\n');expect(workers).toHaveLength(2);
 });
 it('enforces the time limit itself when the worker cannot',async()=>{
  const c=client({hold:async()=>{await new Promise(r=>setTimeout(r,60000));return 0;}});await c.start();
  const {done}=await c.run({command:'hold',timeoutMs:200});workers[0].deaf=workers[0].mute=true;
  const r=await done;expect(r.status).toBe('cancelled');expect(r.output).toMatch(/ran past its 0s time limit/);expect(c.restarts).toBe(1);
 });
});
