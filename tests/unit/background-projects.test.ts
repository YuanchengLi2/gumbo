import {it,expect} from 'vitest';
import {mkdtempSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {BackgroundProjects,sameFolder} from '../../apps/desktop/src/main/background-projects';

class FakeService{closed=0;private done!:()=>void;private exited=new Promise<void>(resolve=>{this.done=resolve;});close(){this.closed++;return this.exited;}exit(){this.done();}}
const folders=()=>{const root=mkdtempSync(join(tmpdir(),'dream-background-')),a=join(root,'Trip'),b=join(root,'Birthday');mkdirSync(a);mkdirSync(b);return{a,b};};

it('keeps a parked project working until it is opened again, and hands its service back',()=>{
 const {a,b}=folders(),projects=new BackgroundProjects<FakeService>(),trip=new FakeService();
 projects.park(trip,{id:'trip',folder:a});
 expect(projects.has(trip)).toBe(true);expect(projects.size).toBe(1);
 expect(projects.take(b)).toBeUndefined();
 const back=projects.take(process.platform==='win32'?a.toUpperCase():a);
 expect(back).toEqual({service:trip,id:'trip'});expect(trip.closed).toBe(0);
 expect(projects.has(trip)).toBe(false);expect(projects.take(a)).toBeUndefined();
});

it('closes a parked project once its request ends, and holds its folder until the service lets go',async()=>{
 const {a}=folders(),projects=new BackgroundProjects<FakeService>(),trip=new FakeService();
 projects.park(trip,{id:'trip',folder:a});
 expect(projects.finished(trip)).toEqual({id:'trip',folder:expect.any(String)});
 expect(trip.closed).toBe(1);expect(projects.has(trip)).toBe(false);expect(projects.finished(trip)).toBeUndefined();
 let released=false;const waiting=projects.released(a).then(()=>{released=true;});
 await Promise.resolve();expect(released).toBe(false);
 trip.exit();await waiting;expect(released).toBe(true);
 await projects.released(a);
});

it('closes every parked and closing project when the app quits',async()=>{
 const {a,b}=folders(),projects=new BackgroundProjects<FakeService>(),trip=new FakeService(),party=new FakeService();
 projects.park(trip,{id:'trip',folder:a});projects.park(party,{id:'party',folder:b});projects.finished(party);
 const quit=projects.closeAll();
 expect(trip.closed).toBe(1);expect(projects.size).toBe(0);
 trip.exit();party.exit();await quit;
});

it('treats two spellings of one folder as the same project',()=>{
 const {a,b}=folders();
 expect(sameFolder(a,join(a,'.'))).toBe(true);expect(sameFolder(a,b)).toBe(false);
 if(process.platform==='win32')expect(sameFolder(a,a.toUpperCase())).toBe(true);
});
