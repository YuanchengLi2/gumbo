import {it,expect} from 'vitest';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProjectDB} from '@dream/project-db';
import {models} from '@dream/config';
import {Director,requestBudgetUsd} from '../../packages/orchestrator/src/code-director';

const fixture=()=>new ProjectDB(mkdtempSync(join(tmpdir(),'dream-safety-')));
const workspace=()=>({initialize:async()=>{},context:()=>({}),execute:async()=>({ok:true})});
const events=(db:ProjectDB,type:string)=>(db.db.prepare('SELECT json FROM events WHERE type=?').all(type) as {json:string}[]).map(e=>JSON.parse(e.json));

it('stops a request at its spending limit before the next call, and a resume allows the same amount again',async()=>{
 const db=fixture();try{
  const director=new Director(db,async()=>{throw new Error('No provider call expected');},()=>{});
  db.recordUsage({requestId:'r1',turnId:'turn',model:models.editor,costUsd:requestBudgetUsd(0)+.01});
  await expect(director.inference(models.editor,'Edit',[{role:'user',content:'Trim it'}],[],'turn',undefined,'execution','main')).rejects.toMatchObject({code:'request_budget'});
  expect(events(db,'ai.request_budget')).toHaveLength(1);
  expect(requestBudgetUsd(1)).toBe(requestBudgetUsd(0)*2);
 }finally{db.close();}
});

it('starts with Haiku when routing fails instead of sending the request to Opus',async()=>{
 const db=fixture();try{
  const director=new Director(db,async()=>({url:'fixture',token:'fixture'}),()=>{},undefined,undefined,undefined,undefined,workspace());
  const models_:string[]=[];
  director.inference=async(model,_s,_m,_t,_turn,_f,purpose='execution')=>{if(purpose==='routing')throw new SyntaxError('Unexpected token');models_.push(model);return{content:[{type:'text',text:'Done.'}],stop_reason:'end_turn',usage:{}};};
  await director.message('Make the whole thing feel more cinematic and exciting');
  const turn=JSON.parse(db.getMeta('pending_request')!).turnId;
  expect(JSON.parse(db.getMeta('routing:'+turn)!).intelligence).toBe('haiku');
  expect(models_.every(m=>m===models.editor)).toBe(true);
  expect(events(db,'ai.escalation')).toHaveLength(0);
 }finally{db.close();}
});

it('records every time Opus takes part in a request, with the reason',async()=>{
 const db=fixture();try{
  const director=new Director(db,async()=>({url:'fixture',token:'fixture'}),()=>{},undefined,undefined,undefined,undefined,workspace());
  director.inference=async(_model,_s,_m,_t,_turn,_f,purpose='execution')=>purpose==='routing'?{content:[{type:'text',text:JSON.stringify({route:'local',intelligence:'opus',complexity:'difficult',reason:'Three new scenes and music'})}],stop_reason:'end_turn',usage:{}}:{content:[{type:'tool_use',id:'done',name:'finish',input:{status:'blocked',summary:'Stopped for the test.',nextAction:'None.'}}],stop_reason:'tool_use',usage:{}};
  await director.message('Build three animated scenes with new music');
  expect(events(db,'ai.escalation')).toEqual([expect.objectContaining({kind:'route',model:models.lead,reason:'Three new scenes and music'})]);
 }finally{db.close();}
});
