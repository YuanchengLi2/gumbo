import {it,expect} from 'vitest';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ProjectDB} from '@dream/project-db';
import {Director} from '../../packages/orchestrator/src/legacy-director';

it('resumes a persisted tool response without repeating a committed mutation',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'dream-ai-recovery-'));const db=new ProjectDB(folder,'Recovery');
 try{
  const expected=db.head(),turnId='turn',ops=[{type:'set_project_settings' as const,settings:{fps:60 as const},reason:'Requested frame rate'}];
  const call={type:'tool_use',id:'tool-1',name:'apply_ops',input:{label:'Frame rate',ops}};
  db.setMeta('editor_checkpoint',JSON.stringify({turnId,messages:[{role:'user',content:'Change frame rate'},{role:'assistant',content:[call]}],pending:[call],results:[],processed:0,toolCount:0,expectedVersion:expected,finished:false}));
  // Simulate a process exit after commit but before the tool-result checkpoint.
  db.apply(ops,'Frame rate','ai:turn:tool-1',expected,turnId);
  const versions=db.state().versions.length;
  const director=new Director(db,async()=>({url:'unused',token:'unused'}),()=>{});
  director.inference=async()=>({content:[{type:'tool_use',id:'report',name:'report',input:{summary:'Frame rate changed.',status:'complete',evidence:[{toolCallId:'tool-1',finding:'Frame rate saved at 60.'}]}}],stop_reason:'tool_use',usage:{}});
  await director.edit('Change frame rate',turnId,[],false);
  expect(db.state().versions).toHaveLength(versions);
  expect(db.timeline().settings.fps).toBe(60);
  expect(JSON.parse(db.getMeta('editor_checkpoint')!).finished).toBe(true);
  db.undo();expect(db.timeline().settings.fps).toBe(30);
 }finally{db.close();}
});
