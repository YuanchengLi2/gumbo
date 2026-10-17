import {it,expect} from 'vitest';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ProjectDB,STOPPED_WHEN_CLOSED} from '@dream/project-db';

const cutOff=()=>{const folder=mkdtempSync(join(tmpdir(),'dream-stopped-'));const db=new ProjectDB(folder,'Stopped');
 db.setMeta('pending_request',JSON.stringify({turnId:'edit',text:'Cut the intro'}));db.userMessage('Cut the intro','edit');db.setMeta('ai_status','running');
 db.activityEvent('edit',{id:'read',kind:'action',text:'Reading the shot index',status:'complete'});
 db.activityEvent('edit',{id:'cut',kind:'action',text:'Cutting the intro',status:'running'});
 return{folder,db};};

it('answers a request the app quit in the middle of, and closes its unfinished steps',()=>{
 const {folder,db:first}=cutOff();first.close();const db=new ProjectDB(folder);try{
  expect(db.recoverStoppedRun()).toBe(true);
  expect(db.getMeta('ai_status')).toBe('interrupted');
  const replies=db.state().messages.filter(m=>m.turnId==='edit'&&m.role==='assistant');
  expect(replies.map(m=>m.text)).toEqual([STOPPED_WHEN_CLOSED]);
  const events=db.turnActivity('edit')!.events!;
  expect(events.find(e=>e.id==='read')!.status).toBe('complete');
  expect(events.find(e=>e.id==='cut')!.status).toBe('interrupted');
  expect(db.recoverStoppedRun()).toBe(false);
  expect(db.state().messages.filter(m=>m.turnId==='edit'&&m.role==='assistant')).toHaveLength(1);
 }finally{db.close();}
});

it('does not add a second reply when the request already answered before it was cut off',()=>{
 const {folder,db:first}=cutOff();first.message('assistant','Stopped.','edit');first.close();const db=new ProjectDB(folder);try{
  db.recoverStoppedRun();
  expect(db.state().messages.filter(m=>m.turnId==='edit'&&m.role==='assistant').map(m=>m.text)).toEqual(['Stopped.']);
 }finally{db.close();}
});

it('leaves a project alone when nothing was running',()=>{
 const folder=mkdtempSync(join(tmpdir(),'dream-stopped-'));const db=new ProjectDB(folder,'Idle');try{
  db.setMeta('ai_status','complete');
  expect(db.recoverStoppedRun()).toBe(false);expect(db.getMeta('ai_status')).toBe('complete');expect(db.state().messages).toEqual([]);
 }finally{db.close();}
});
