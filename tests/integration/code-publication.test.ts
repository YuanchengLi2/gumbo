import {it,expect} from 'vitest';
import {mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProjectDB} from '@dream/project-db';
import {CodeWorkspace} from '../../apps/project-service/src/code-workspace';
import {publishWorkspace} from '../../apps/project-service/src/code-publication';
import {collectProject} from '../../apps/project-service/src/collect';
import type {ProcessResult} from '@dream/contracts';
const processResult=(id:string):ProcessResult=>({id,status:'complete',exitCode:0,startedAt:'fixture',finishedAt:'fixture',output:'',logPath:'',isolation:'windows-appcontainer',commandHash:id});
it('publishes code and timeline exactly once, restores both through undo/redo and collects without packages',async()=>{
 const root=mkdtempSync(join(tmpdir(),'dream-code-')),db=new ProjectDB(root,'Code');const ws=new CodeWorkspace(db,{run:async()=>{throw new Error('unexpected run');},ffmpeg:'',ffprobe:''},()=>{});
 try{await ws.initialize();const original=db.head(),file=join(root,'Workspace','project.json'),doc=JSON.parse(readFileSync(file,'utf8'));doc.timeline.settings.fps=24;writeFileSync(file,JSON.stringify(doc));writeFileSync(join(root,'Workspace/src/edit.js'),'// editable source');
 const saved=await publishWorkspace(db,processResult('first'),'turn','');expect(saved?.baseVersionId).toBe(original);expect(db.timeline().settings.fps).toBe(24);expect(await publishWorkspace(db,processResult('first'),'turn','')).toEqual(saved);expect(db.state().versions).toHaveLength(2);
 db.workspace.queueRestore(db.head());db.workspace.restorePending();const snapshot=readFileSync(file,'utf8');expect(JSON.parse(snapshot).baseVersionId).toBe(db.head());
 expect(await publishWorkspace(db,processResult('noop'),'turn','')).toBeUndefined();
 db.undo();db.workspace.restorePending();expect(db.timeline().settings.fps).toBe(30);expect(JSON.parse(readFileSync(file,'utf8')).timeline.settings.fps).toBe(30);
 db.undo(true);db.workspace.restorePending();expect(db.timeline().settings.fps).toBe(24);expect(readFileSync(join(root,'Workspace/src/edit.js'),'utf8')).toBe('// editable source');
 const destination=mkdtempSync(join(tmpdir(),'dream-code-collected-'));await collectProject(db,destination);const reopened=new ProjectDB(destination);try{expect(reopened.timeline().settings.fps).toBe(24);expect(reopened.workspace.snapshot(reopened.head())).toBeTruthy();expect(readFileSync(join(destination,'Workspace/src/edit.js'),'utf8')).toBe('// editable source');}finally{reopened.close();}
 }finally{db.close();}
});
it('rejects stale documents and failed processes without changing published history',async()=>{const root=mkdtempSync(join(tmpdir(),'dream-stale-')),db=new ProjectDB(root);try{const ws=new CodeWorkspace(db,{run:async()=>processResult('one'),ffmpeg:'',ffprobe:''},()=>{});await ws.initialize();const before=db.head(),path=join(root,'Workspace/project.json'),doc=JSON.parse(readFileSync(path,'utf8'));doc.baseVersionId='stale';writeFileSync(path,JSON.stringify(doc));await expect(publishWorkspace(db,processResult('stale'),'turn','')).rejects.toThrow('changed');await expect(publishWorkspace(db,{...processResult('failed'),status:'failed',exitCode:1},'turn','')).rejects.toThrow('successful');expect(db.head()).toBe(before);}finally{db.close();}});
