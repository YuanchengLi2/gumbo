import {it,expect} from 'vitest';
import {mkdtempSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import ffmpeg from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import {ProjectDB} from '@dream/project-db';
import {TimelineSchema} from '@dream/timeline';
import {CodeWorkspace} from '../../apps/project-service/src/code-workspace';
import {ProjectContext} from '../../packages/orchestrator/src/context';

it('lets the agent see its earlier versions and read its own files as they were, to bring earlier work back',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'dream-history-')),db=new ProjectDB(folder,'History');
 const workspace=new CodeWorkspace(db,{run:async()=>{throw new Error('no commands');},ffmpeg:ffmpeg!,ffprobe:ffprobe.path},()=>{});
 const say=(turnId:string,role:string,text:string)=>db.db.prepare('INSERT INTO messages(id,role,text,created_at,turn_id) VALUES(?,?,?,?,?)').run(turnId+role,role,text,new Date().toISOString(),turnId);
 // A request's publication: the timeline version and the workspace files it was made from.
 const publish=(turnId:string,text:string,title:string)=>{
  mkdirSync(join(db.folder,'Workspace','src'),{recursive:true});writeFileSync(join(db.folder,'Workspace','src','hook.tsx'),text);
  const v=db.writeVersion(TimelineSchema.parse({...db.timeline(),beats:[{id:title,purpose:title}]}),db.head(),'Saved project updates',turnId);
  db.db.prepare('UPDATE branches SET head_id=? WHERE id=?').run(v,'main');db.workspace.associate(v,db.workspace.capture().hash);return v;
 };
 try{
  await workspace.initialize();
  say('t1','user','make a hook with the diamond and dirt blocks');say('t1','assistant','The hook compares the diamond block and the dirt block.');
  const first=publish('t1','<Diamond/> VS <Dirt/>','two-items');
  say('t2','user','the vs is empty');say('t2','assistant','I rebuilt the VS as plain yellow text.');
  publish('t2','<Text>VS</Text>','plain-text');
  const history=new ProjectContext(db).history();
  expect(history[0]).toMatch(/\| current \| asked: the vs is empty \| reply: I rebuilt the VS as plain yellow text\.$/);
  expect(history[1]).toBe(`${first} | ${history[1].split(' | ')[1]} | asked: make a hook with the diamond and dirt blocks | reply: The hook compares the diamond block and the dirt block.`);
  expect((new ProjectContext(db).initial('revert') as any).history).toEqual(history);
  // "revert the text change": the earlier hook, read as it was, ready to write back.
  const signal=new AbortController().signal;
  expect(await workspace.execute('read_file',{path:'src/hook.tsx',version:first},'r1',db.head(),signal)).toMatchObject({version:first,text:'<Diamond/> VS <Dirt/>'});
  expect(await workspace.execute('list_files',{path:'src',version:first},'l1',db.head(),signal)).toEqual([{name:'hook.tsx',kind:'file'}]);
  const project:any=await workspace.execute('read_file',{path:'project.json',version:first,limit:400},'r2',db.head(),signal);
  const doc=JSON.parse(project.text);expect(doc.baseVersionId).toBe(db.head());expect(doc.outputs).toEqual([]);expect(doc.timeline.beats).toEqual([{id:'two-items',purpose:'two-items'}]);
  await expect(workspace.execute('read_file',{path:'src/missing.tsx',version:first},'r3',db.head(),signal)).rejects.toThrow(/not in version/);
  await expect(workspace.execute('read_file',{path:'src/hook.tsx',version:'v_unknown'},'r4',db.head(),signal)).rejects.toThrow(/history/);
 }finally{db.close();}
},60_000);
