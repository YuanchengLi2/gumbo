import {it,expect} from 'vitest';import {mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {ProjectDB} from '@dream/project-db';import {AssetSchema} from '@dream/footage';
it('commits idempotently and persists grouped undo and redo after reopen',()=>{const folder=mkdtempSync(join(tmpdir(),'dream-db-'));let db=new ProjectDB(folder,'Fixture');try{const initial=db.head();db.apply([{type:'set_project_settings',settings:{width:1280,height:720},reason:'format'}],'Format','request1',initial,'turn1');const head=db.head();db.apply([{type:'set_project_settings',settings:{fps:60},reason:'fps'}],'FPS','request2',head,'turn1');db.apply([{type:'set_project_settings',settings:{width:1280,height:720},reason:'format'}],'Format','request1',initial,'turn1');expect(db.timeline().settings.fps).toBe(60);db.close();db=new ProjectDB(folder);db.undo();expect(db.timeline().settings).toMatchObject({width:1920,height:1080,fps:30});db.undo(true);expect(db.timeline().settings).toMatchObject({width:1280,height:720,fps:60});const old=db.head();db.restore(initial);expect(db.head()).not.toBe(initial);expect(db.state().versions.some(v=>v.id===old)).toBe(true);}finally{db.close();rmSync(folder,{recursive:true,force:true});}});

it('rejects reused IDs with changed intent and reconstructs legacy receipts without replaying edits',()=>{
 const folder=mkdtempSync(join(tmpdir(),'dream-request-'));let db=new ProjectDB(folder,'Identity');try{
  const before=db.head(),ops=[{type:'set_project_settings' as const,settings:{width:1280 as const,height:720 as const},reason:'format'}];const result=db.apply(ops,'Format','same',before,'turn');
  const assertMismatch=()=>{expect(()=>db.apply([{...ops[0],settings:{fps:60}}],'Format','same',before,'turn')).toThrow('different edit');expect(()=>db.apply(ops,'Other','same',before,'turn')).toThrow('different edit');expect(()=>db.apply(ops,'Format','same',db.head(),'turn')).toThrow('different edit');expect(()=>db.apply(ops,'Format','same',before,'other-turn')).toThrow('different edit');};
  assertMismatch();db.db.exec('ALTER TABLE requests DROP COLUMN identity');db.db.pragma('user_version=2');db.close();db=new ProjectDB(folder);
  expect(db.apply([{reason:'format',settings:{height:720,width:1280},type:'set_project_settings'}],'Format','same',before,'turn').versionId).toBe(result.versionId);assertMismatch();expect(db.state().versions).toHaveLength(2);
  expect((db.db.prepare('SELECT identity FROM requests WHERE id=?').get('same') as {identity:string}).identity).toMatch(/^[a-f0-9]{64}$/);
 }finally{db.close();rmSync(folder,{recursive:true,force:true});}
});

it('relinks footage whose original is gone to the project\'s own copy in Sources/, and leaves the rest alone',()=>{
 const folder=mkdtempSync(join(tmpdir(),'dream-relink-')),downloads=mkdtempSync(join(tmpdir(),'dream-downloads-'));let db=new ProjectDB(folder,'Trip');try{
  const asset=(id:string,originalPath:string)=>AssetSchema.parse({id,filename:'clip.mp4',kind:'video',originalPath,durationSec:10,width:1920,height:1080,fps:30,hasAudio:true,fingerprint:id,status:'ready'});
  const copy=(id:string)=>{mkdirSync(join(folder,'Sources',id),{recursive:true});writeFileSync(join(folder,'Sources',id,'clip.mp4'),'CLIP');};
  // a_1: original gone, copy here. a_2: original still here. a_3: original gone and no copy.
  const kept=join(downloads,'kept.mp4');writeFileSync(kept,'KEPT');
  db.saveAsset(asset('a_1',join(downloads,'gone','clip.mp4')));db.saveAsset(asset('a_2',kept));db.saveAsset(asset('a_3',join(downloads,'lost','clip.mp4')));copy('a_1');copy('a_2');
  expect(db.relinkFromSources()).toBe(1);
  const paths=Object.fromEntries(db.footage().assets.map(a=>[a.id,a.originalPath]));
  expect(paths).toEqual({a_1:join(folder,'Sources','a_1','clip.mp4'),a_2:kept,a_3:join(downloads,'lost','clip.mp4')});
  expect(db.relinkFromSources()).toBe(0);
 }finally{db.close();rmSync(folder,{recursive:true,force:true});rmSync(downloads,{recursive:true,force:true});}
});
