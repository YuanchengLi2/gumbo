import {it,expect} from 'vitest';
import {mkdtempSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ProjectDB} from '@dream/project-db';
import {TimelineSchema} from '@dream/timeline';
import {Workspace} from '../../apps/project-service/src/workspace';
import {call,textOf} from '../fixtures/agent-project';

/** The text of a read without its line numbers. */
const body=(read:unknown)=>textOf(read).split('\n').slice(1).filter(l=>/^\s*\d+\t/.test(l)).map(l=>l.replace(/^\s*\d+\t/,'')).join('\n');

it('lets the agent see its earlier versions and read its own files as they were, to bring earlier work back',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'dream-history-')),db=new ProjectDB(folder,'History');
 const workspace=new Workspace(db,{run:async()=>{throw new Error('no commands');},ffmpeg:'',ffprobe:''},()=>{});
 const say=(turnId:string,role:string,text:string)=>db.db.prepare('INSERT INTO messages(id,role,text,created_at,turn_id) VALUES(?,?,?,?,?)').run(turnId+role,role,text,new Date().toISOString(),turnId);
 // A request's version: the timeline and the workspace files it was made from.
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
  const second=publish('t2','<Text>VS</Text>','plain-text');
  // HISTORY.md lists the versions newest first, with what was asked for each.
  workspace.messageContext({turnId:'t3',text:'revert the text change',selection:[],assetIds:[],known:[]});
  const history=body(await call(workspace,'read',{path:'HISTORY.md'})).split('\n').filter(l=>l.startsWith('- '));
  expect(history[0]).toMatch(new RegExp(`^- ${second} · .* · Roux, asked "the vs is empty" · Saved project updates \\(current\\)$`));
  expect(history[1]).toMatch(new RegExp(`^- ${first} · .* · Roux, asked "make a hook with the diamond and dirt blocks" · Saved project updates$`));
  // "revert the text change": the earlier hook, read as it was, ready to write back.
  expect(body(await call(workspace,'read',{path:'src/hook.tsx',version:first}))).toBe('<Diamond/> VS <Dirt/>');
  expect(textOf(await call(workspace,'list',{path:'src',version:first}))).toBe('src/hook.tsx');
  const doc=JSON.parse(body(await call(workspace,'read',{path:'project.json',version:first,limit:2000})));
  expect(doc.baseVersionId).toBe(db.head());expect(doc.outputs).toEqual([]);expect(doc.timeline.beats).toEqual([{id:'two-items',purpose:'two-items'}]);
  await expect(call(workspace,'read',{path:'src/missing.tsx',version:first})).rejects.toThrow(/not in version/);
  await expect(call(workspace,'read',{path:'src/hook.tsx',version:'v_unknown'})).rejects.toThrow(/No saved files/);
  // History is written from the project: it cannot be written over.
  await expect(call(workspace,'write',{path:'HISTORY.md',content:'mine'})).rejects.toThrow(/cannot be changed/);
 }finally{workspace.close();db.close();}
},60_000);
