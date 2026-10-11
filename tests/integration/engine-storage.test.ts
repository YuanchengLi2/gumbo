import {it,expect} from 'vitest';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProjectDB} from '@dream/project-db';
import {VisualSourceStore} from '../../packages/project-db/src/visual-source-store';
import {compileVisualGraph} from '../../apps/desktop/src/sandbox/compile';
import {budgetRequest} from '../../packages/orchestrator/src/context-budget';
import {ProjectContext} from '../../packages/orchestrator/src/context';
import {rememberDecision} from '../../packages/orchestrator/src/project-memory';
import {documentDelta,applyDocumentDelta} from '../../packages/timeline/src/document-delta';

it('reconstructs optional fields and keyed collection changes without copying unchanged items',()=>{
 const before={spine:[{id:'a',value:1},{id:'b',value:2}],settings:{fps:30}},after={spine:[{id:'b',value:3},{id:'c',value:4},{id:'a',value:1}],settings:{fps:30}};
 const delta=documentDelta(before,after);expect(delta[0].collection?.put.map(v=>v.id)).toEqual(['b','c']);expect(applyDocumentDelta(before,delta)).toEqual(after);
 const db=new ProjectDB(mkdtempSync(join(tmpdir(),'dream-optional-')),'Optional');try{const first=db.apply([{type:'set_captions',captions:{style:'clean',params:{z:1,a:2},overrides:[]},reason:'Enable captions'}],'Captions','one',db.head());expect(db.timeline(first.versionId).captions?.params).toEqual({z:1,a:2});const second=db.apply([{type:'set_captions',captions:{style:'clean',params:{b:3,z:1,a:2},overrides:[]},reason:'Revise parameters'}],'Parameters','two',db.head());expect(db.timeline(second.versionId).captions?.params).toEqual({b:3,z:1,a:2});}finally{db.close();}
});

it('stores append-only exchanges and reconstructs 55 timeline revisions after reopening',()=>{
 const folder=mkdtempSync(join(tmpdir(),'dream-storage-'));let db=new ProjectDB(folder,'Storage');
 try{
  const versions:{id:string;fps:number}[]=[];for(let n=0;n<55;n++){const out=db.apply([{type:'set_project_settings',settings:{fps:n%2?24:30},reason:'Fixture'}],'Format','r'+n,db.head());versions.push({id:out.versionId,fps:n%2?24:30});}
  const state={turnId:'turn',messages:[{role:'user',content:'Keep the original voice.'}],processed:0};db.saveState('checkpoint',state);
  for(let n=0;n<30;n++){state.processed=n;db.saveState('checkpoint',state);}
  expect((db.db.prepare('SELECT COUNT(*) AS n FROM execution_journal').get() as any).n).toBe(1);
  expect((db.db.prepare('SELECT MAX(depth) AS n FROM version_storage').get() as any).n).toBe(49);
  expect((db.db.prepare("SELECT COUNT(*) AS n FROM versions WHERE snapshot<>''").get() as any).n).toBe(0);
  const stored=db.db.prepare('SELECT result FROM requests LIMIT 1').get() as any;expect(JSON.parse(stored.result)).not.toHaveProperty('timeline');
  db.close();db=new ProjectDB(folder);for(const version of versions)expect(db.timeline(version.id).settings.fps).toBe(version.fps);expect(db.loadState<any>('checkpoint')!.messages).toEqual(state.messages);
 }finally{db.close();}
});

it('reuses module blobs, patches exact revisions, changes parameters without new source, and compiles scoped modules',()=>{
 const db=new ProjectDB(mkdtempSync(join(tmpdir(),'dream-modules-')),'Modules');try{
  const store=new VisualSourceStore(db),draft=store.create({schemaVersion:1,id:'scene',title:'Scene',code:"import React from 'react';export default function Scene(){return <div>Hello</div>}",parameterSchema:{},parameters:{},width:320,height:180,fps:30,durationInFrames:30,seed:1});
  const original=draft.definition.source!.modules['scene.tsx'];const changed=store.parameters(draft.id,draft.revision,{color:'violet'});expect(changed.definition.source!.modules['scene.tsx']).toBe(original);
  expect(()=>store.patch(draft.id,draft.revision,'scene.tsx',original,'Hello','World')).toThrow('changed');
  const patched=store.patch(draft.id,changed.revision,'scene.tsx',original,'Hello','World');expect(store.read(original).text).toContain('Hello');expect(store.read(patched.definition.source!.modules['scene.tsx']).text).toContain('World');
  const helper=store.write(draft.id,patched.revision,'accent.tsx',"export const accent='violet';");const entry=store.write(draft.id,helper.revision,'scene.tsx',"import React from 'react';import {accent} from './accent';export default function Scene(){return <div style={{color:accent}}>Hello</div>}");
  const compiled=compileVisualGraph(store.hydrate(entry.definition));expect(typeof compiled).toBe('object');expect(JSON.stringify(compiled)).toContain('./module-');expect(JSON.stringify(compiled)).not.toContain("from './accent'");
  const bad=store.write(draft.id,entry.revision,'scene.tsx',"import fs from '../private';export default ()=>null;");expect(()=>compileVisualGraph(store.hydrate(bad.definition))).toThrow('Imports');
  expect(db.timeline().spine).toHaveLength(0);
 }finally{db.close();}
});

it('retrieves older user direction and enforces revision checks and irreducible context budgets',()=>{
 const db=new ProjectDB(mkdtempSync(join(tmpdir(),'dream-memory-')),'Memory');try{
  const source=db.message('user','Amethyst titles must be violet, never orange.');for(let n=0;n<6;n++)db.message('assistant','Unrelated message '+n);
  db.setMeta('workflow:approved',JSON.stringify({plan:{goal:'Keep Amethyst typography restrained'},status:'complete',approvedVersion:db.head()}));
  const context=new ProjectContext(db);expect(context.search('restrained',6,{kind:'workflow'})[0]?.owner).toBe('approved');expect(JSON.stringify(context.initial('Amethyst titles'))).toContain('never orange');
  rememberDecision(db,{sourceId:source.id,scope:'titles',text:source.text});expect(()=>rememberDecision(db,{sourceId:source.id,scope:'titles',text:'Use red'})).toThrow("the user's own words");
  const hit=context.search('Amethyst')[0] as any;expect(()=>context.read(hit.id,'outdated')).toThrow('changed');
  expect(budgetRequest(db,{model:'claude-sonnet-5-5',purpose:'routine',system:'Instructions',tools:[],messages:[{role:'user',content:'x'.repeat(500000)}],max_tokens:8192}).needsCount).toBe(true);
 }finally{db.close();}
});
