import {it,expect} from 'vitest';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ProjectDB} from '@dream/project-db';
import {AssetSchema} from '@dream/footage';
import {Director} from '../../packages/orchestrator/src/legacy-director';
import {OutlineSchema} from '@dream/contracts';

it('validates and commits approval atomically, rejecting stale versions and replaying request identities without another build',async()=>{
 const db=new ProjectDB(mkdtempSync(join(tmpdir(),'dream-approval-')),'Approval');
 try{
  db.saveAsset(AssetSchema.parse({id:'a',filename:'a.mp4',kind:'video',durationSec:6,originalPath:'a.mp4',fingerprint:'f'}));
  const outline=OutlineSchema.parse({goal:'Opening',targetDurationSec:3,beats:[{id:'intro',purpose:'Intro',targetSec:3,sources:[{assetId:'a',srcIn:0,srcOut:3}]}]});
  db.setMeta('outline',JSON.stringify(outline));db.setMeta('outline_turn','turn');db.setMeta('outline_version',db.head());db.setMeta('ai_status','awaiting_approval');
  const before=db.head(),director=new Director(db,async()=>({url:'unused',token:'unused'}),()=>{});let edits=0;
  director.edit=async()=>{edits++;throw new Error('Simulated connection loss after build');};
  const invalid=structuredClone(outline);invalid.beats[0].sources[0].srcOut=9;
  await expect(director.approve(invalid,before,'invalid')).rejects.toThrow();expect(db.head()).toBe(before);expect(db.getMeta('ai_status')).toBe('awaiting_approval');expect(db.getMeta('approved:invalid')).toBeUndefined();
  await expect(director.approve(outline,'stale','stale')).rejects.toThrow('edit changed');expect(db.head()).toBe(before);
  await director.approve(outline,before,'approval');const versionCount=db.state().versions.length;
  expect(db.timeline().spine).toHaveLength(1);expect(db.getMeta('ai_status')).toBe('interrupted');expect(db.getMeta('outline')).toBe('');
  await director.approve(outline,before,'approval');expect(edits).toBe(1);expect(db.state().versions).toHaveLength(versionCount);
  db.undo();expect(db.timeline().spine).toHaveLength(0);
 }finally{db.close();}
});
