import {it,expect} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProjectDB} from '@dream/project-db';
import {CodeWorkspace} from '../../apps/project-service/src/code-workspace';

/** After the user undoes or restores the agent's work, the next request's context says so (code-workspace.ts
 * sinceLastRequest), and a restore names the version it went back to. */
const fixture=()=>{const root=mkdtempSync(join(tmpdir(),'dream-since-')),db=new ProjectDB(root,'Since');const ws=new CodeWorkspace(db,{run:async()=>{throw Error('No command expected');},ffmpeg:'',ffprobe:''},()=>{});return{root,db,ws};};
const settings=(width:1280|1920,height:720|1080,reason:string)=>[{type:'set_project_settings' as const,settings:{width,height},reason}];

it('tells the next request what the user undid or restored after the agent\'s last edit',async()=>{
 const {root,db,ws}=fixture();try{await ws.initialize();
  // No agent edit yet: nothing to report.
  expect((ws.context('anything') as any).sinceLastRequest).toBeUndefined();
  // The agent's two edits, then the user restores the first.
  const first=db.apply(settings(1280,720,'smaller'),'Made it 720p','r1',db.head(),'turn-1').versionId;
  db.apply(settings(1920,1080,'bigger'),'Added a big title','r2',db.head(),'turn-2');
  expect((ws.context('anything') as any).sinceLastRequest).toBeUndefined();
  db.restore(first);
  const since=(ws.context('next request') as any).sinceLastRequest;
  expect(since.changes).toEqual(['Restored version: Made it 720p']);
  expect(since.note).toMatch(/gone on purpose/);
  // Once the agent edits again, the earlier restore is history.
  db.apply(settings(1920,1080,'again'),'Graded the clips','r3',db.head(),'turn-3');
  expect((ws.context('anything') as any).sinceLastRequest).toBeUndefined();
  db.undo();
  expect((ws.context('anything') as any).sinceLastRequest.changes).toEqual(['Undo']);
 }finally{db.close();rmSync(root,{recursive:true,force:true});}
});
