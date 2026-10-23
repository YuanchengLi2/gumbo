import {describe,it,expect,beforeAll,afterAll} from 'vitest';
import * as nodeFs from 'node:fs';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fs as zenfs} from '@zenfs/core';
import {MemoryFS} from '../src/fs/memory';
import {nodeLikeFS,type NodeLikeFS} from '../src/fs/node-like';
import {fromZenFS} from '../src/fs/zenfs';
import type {SandboxFS} from '../src/fs/types';
import {encoder,decode} from '../src/fs/util';
import {Sandbox} from '../src/sandbox';

/** The same checks for every file system the sandbox runs on: errors carry node's codes, handles read and write at
 * positions, and a whole command works on it. */
function conformance(name:string,make:()=>SandboxFS){
 describe(name,()=>{
  let fs:SandboxFS;beforeAll(()=>{fs=make();fs.mkdir('/t',true);});
  it('makes folders, writes, reads, lists and stats',()=>{
   fs.mkdir('/t/a/b',true);fs.writeFile('/t/a/b/f.txt',encoder.encode('hello'));fs.appendFile('/t/a/b/f.txt',encoder.encode(' world'));
   expect(decode(fs.readFile('/t/a/b/f.txt'))).toBe('hello world');expect(fs.readdir('/t/a')).toEqual(['b']);
   const s=fs.stat('/t/a/b/f.txt');expect(s.type).toBe('file');expect(s.size).toBe(11);expect(fs.stat('/t/a').type).toBe('directory');
  });
  it('throws node-style error codes',()=>{
   const code=(f:()=>unknown)=>{try{f();}catch(e){return(e as {code:string}).code;}return'none';};
   expect(code(()=>fs.stat('/t/missing'))).toBe('ENOENT');expect(code(()=>fs.mkdir('/t/a',false))).toBe('EEXIST');
   expect(code(()=>fs.rmdir('/t/a'))).toBe('ENOTEMPTY');expect(code(()=>fs.readdir('/t/a/b/f.txt'))).toBe('ENOTDIR');
  });
  it('reads and writes through handles at positions',()=>{
   const h=fs.open('/t/h.bin','w');h.write(new Uint8Array([1,2,3,4]),0);h.write(new Uint8Array([9]),2);expect(h.size()).toBe(4);h.truncate(3);h.close();
   const r=fs.open('/t/h.bin','r'),buffer=new Uint8Array(8);expect(r.read(buffer,1)).toBe(2);expect([...buffer.subarray(0,2)]).toEqual([2,9]);r.close();
   const a=fs.open('/t/h.bin','a');a.write(new Uint8Array([7]),0);a.close();expect([...fs.readFile('/t/h.bin')]).toEqual([1,2,9,7]);
  });
  it('renames and removes',()=>{
   fs.rename('/t/h.bin','/t/a/moved.bin');expect(fs.readdir('/t/a').sort()).toEqual(['b','moved.bin']);fs.unlink('/t/a/moved.bin');
   fs.unlink('/t/a/b/f.txt');fs.rmdir('/t/a/b');fs.rmdir('/t/a');expect(fs.readdir('/t')).toEqual([]);
  });
  it('runs a command over it',async()=>{
   const sandbox=new Sandbox(fs,{workspace:'/t/ws'});
   const r=await sandbox.runCommand({command:'mkdir -p out && printf "b\\na\\n" > out/x.txt && sort out/x.txt | tee out/y.txt && ls out && rm -r out && ls'});
   expect(r.process.status).toBe('complete');expect(r.process.output).toBe('a\nb\nx.txt\ny.txt\n');
  });
 });
}
conformance('MemoryFS',()=>new MemoryFS());
let temp='';
conformance('node:fs through nodeLikeFS',()=>{temp=mkdtempSync(join(tmpdir(),'web-sandbox-'));return nodeLikeFS(nodeFs as unknown as NodeLikeFS,temp.replace(/\\/g,'/'));});
afterAll(()=>{if(temp)rmSync(temp,{recursive:true,force:true});});
conformance('ZenFS (InMemory) through fromZenFS',()=>{zenfs.mkdirSync('/sandbox-test',{recursive:true});return fromZenFS(zenfs,'/sandbox-test');});
describe('MemoryFS extras',()=>{
 it('follows symlinks and counts its memory',()=>{
  const fs=new MemoryFS({'a/real.txt':'x'});fs.symlink!('/a/real.txt','/a/link');expect(decode(fs.readFile('/a/link'))).toBe('x');
  expect(fs.lstat('/a/link').type).toBe('symlink');expect(fs.readlink!('/a/link')).toBe('/a/real.txt');expect(fs.memoryBytes()).toBeGreaterThan(0);
 });
 it('grows files written in small pieces without copying each time',()=>{
  const fs=new MemoryFS(),h=fs.open('/big','w'),chunk=new Uint8Array(4096).fill(1);
  for(let i=0;i<1000;i++)h.write(chunk,i*4096);h.close();expect(fs.stat('/big').size).toBe(4096000);
 });
});
