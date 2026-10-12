import {it,expect} from 'vitest';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,existsSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {atomicArtifact} from '../../apps/project-service/src/artifacts';
import {acquireProjectLock} from '../../apps/project-service/src/locks';

it('keeps the original completed artifact when processing is interrupted',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'dream-artifact-')),output=join(folder,'proxy.mp4');
 writeFileSync(output,'complete');
 await expect(atomicArtifact(output,async path=>{writeFileSync(path,'partial');throw new Error('canceled');})).rejects.toThrow('canceled');
 expect(readFileSync(output,'utf8')).toBe('complete');
 expect(readdirSync(folder)).toEqual(['proxy.mp4']);
});
it('does not remove another living writer lock after rejecting an open',()=>{
 const folder=mkdtempSync(join(tmpdir(),'dream-lock-'));mkdirSync(join(folder,'.dream'));
 const lock=acquireProjectLock(folder),before=readFileSync(lock,'utf8');
 expect(()=>acquireProjectLock(folder)).toThrow('another Figjam window');
 expect(existsSync(lock)).toBe(true);expect(readFileSync(lock,'utf8')).toBe(before);
});
