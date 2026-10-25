import {describe,it,expect} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProjectDB,STOPPED_WHEN_CLOSED} from '@dream/project-db';
import {turnLog,finalStatus,redact} from '../../apps/project-service/src/turn-log';

/** One edit's log (apps/project-service/src/turn-log.ts), what every finished run sends: enough to trace an edit by its
 * calls, tools and commentary, and nothing it must not carry (footage, pictures, keys). */
function project(){
 const folder=mkdtempSync(join(tmpdir(),'gumbo-turn-log-')),db=new ProjectDB(folder,'Trip');
 db.setMeta('pending_request',JSON.stringify({turnId:'t1',text:'Cut the boring parts'}));db.userMessage('Cut the boring parts','t1');
 db.setMeta('ai_status','running');db.setMeta('run_started_at','2026-10-21T10:00:01.000Z');
 const usage=db.db.prepare('INSERT INTO ai_usage(request_id,turn_id,model,purpose,phase,input_tokens,cache_read,output_tokens,cost_usd,duration_ms,stop_reason,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)');
 usage.run('r1','t1','deepseek-v4.1-flash','execution','main',12000,30000,800,0.012,4200,'tool_use','2026-10-21T10:00:05.000Z');
 usage.run('r2','t1','deepseek-v4.1-flash','execution','main',2000,40000,300,0.0085,3100,'end_turn','2026-10-21T10:00:20.000Z');
 db.activityEvent('t1',{id:'tool:c1',kind:'action',tool:'run',text:'Running a command',status:'failed',detail:'exit 1'});
 // The project's conversation: an earlier request, then this one's part (packages/agent/src/session.ts).
 const result={type:'tool_result',tool_use_id:'c1',is_error:true,content:[{type:'text',text:'exit 1\nANTHROPIC_API_KEY=sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123'},{type:'image',source:{type:'base64',media_type:'image/jpeg',data:'A'.repeat(6000)}}]};
 db.saveState('agent-session',{id:'s',model:'deepseek-v4.1-flash',auto:true,effort:'auto',known:[],compactions:0,createdAt:'2026-10-21T09:00:00.000Z',turns:{t0:0,t1:2},messages:[
  {role:'user',content:[{type:'text',text:'Project start'},{type:'text',text:'Make it warmer'}]},
  {role:'assistant',content:[{type:'text',text:'Warmer now.'}]},
  {role:'user',content:[{type:'text',text:'Cut the boring parts'}]},
  {role:'assistant',content:[{type:'text',text:'I will trim the pauses.'},{type:'tool_use',id:'c1',name:'run',input:{command:'curl -H "Authorization: Bearer abcdefghijklmnop123456" https://api.example.com?api_key=s3cr3tvalue'}}]},
  {role:'user',content:[result]},
  {role:'assistant',content:[{type:'thinking',thinking:'Retry without the header.',signature:'opaque'.repeat(50)},{type:'text',text:'Trimmed the pauses.'}]},
 ]});
 db.saveState('agent-call:c1',{block:result});
 db.message('assistant','Trimmed the pauses.','t1',{status:'complete',summary:'Trimmed the pauses.',kind:'completion',evidence:[]});db.setMeta('ai_status','complete');
 return{db,folder};
}

describe('an edit’s log',()=>{
 it('carries the request, model calls, tools with inputs and results, timings, cost and how it ended',()=>{
  const {db}=project(),log=turnLog(db,'t1');
  expect(log).toMatchObject({version:3,turnId:'t1',project:{name:'Trip'},request:'Cut the boring parts'});
  expect(log.outcome).toMatchObject({status:'complete',aiStatus:'complete',kind:'completion',result:'complete',summary:'Trimmed the pauses.',ending:'Trimmed the pauses.'});
  expect(log.usage.map((u:any)=>[u.model,u.duration_ms,u.stop_reason])).toEqual([['deepseek-v4.1-flash',4200,'tool_use'],['deepseek-v4.1-flash',3100,'end_turn']]);
  expect(log.cost).toEqual({usd:0.0205,credits:2.1,calls:2,inputTokens:84000,outputTokens:1100});
  expect(log.timing).toMatchObject({runStartedAt:'2026-10-21T10:00:01.000Z',modelMs:7300});expect(log.timing.durationMs).toBeGreaterThan(0);
  expect(log.tools).toEqual([expect.objectContaining({callId:'c1',tool:'run',status:'failed',input:{command:expect.stringContaining('curl')}})]);
  // Only this request's part of the conversation: from its message to the end.
  expect(log.conversation[0]).toMatchObject({phase:'main',model:'deepseek-v4.1-flash'});expect(log.conversation[0].messages).toHaveLength(4);expect(log.conversation[0].messages[0].content[0].text).toBe('Cut the boring parts');
  expect(log.activity[0]).toMatchObject({tool:'run',status:'failed'});
 });
 it('leaves out pictures and signatures and blanks keys and tokens',()=>{
  const {db}=project(),text=JSON.stringify(turnLog(db,'t1'));
  expect(text).not.toContain('AAAAAAAAAA');expect(text).toContain('"leftOut":true');expect(text).not.toContain('opaqueopaque');
  for(const secret of ['abcdefghijklmnop123456','s3cr3tvalue','sk-ant-api03'])expect(text).not.toContain(secret);
  expect(text).toContain('Bearer [redacted]');expect(text).toContain('ANTHROPIC_API_KEY=[redacted]');
  // Ordinary numbers and words that only look like settings stay.
  expect(redact('const MAX_TOKENS = 4000; "input_tokens":12')).toBe('const MAX_TOKENS = 4000; "input_tokens":12');
  expect(redact('{"password":"hunter2","token":"abc"}')).toBe('{"password":"[redacted]","token":"[redacted]"}');
 });
 it('says how a request ended',()=>{
  expect(finalStatus('complete',{kind:'completion'},'Done.')).toBe('complete');
  expect(finalStatus('interrupted',{kind:'blocker'},'Repeated attempts could not complete this step')).toBe('failed');
  expect(finalStatus('interrupted',undefined,'The model is unavailable.')).toBe('failed');
  expect(finalStatus('interrupted',undefined,'Stopped.')).toBe('stopped');
  expect(finalStatus('interrupted',undefined,STOPPED_WHEN_CLOSED)).toBe('interrupted');
  expect(finalStatus('awaiting_approval',undefined,'')).toBe('waiting');
 });
 it('marks a request the app closed in the middle of as interrupted',()=>{
  // Asked to carry on, then the app closed before any reply.
  const {db,folder}=project();db.message('user','Also add music','t1');db.setMeta('ai_status','running');db.close();
  const reopened=new ProjectDB(folder);expect(reopened.recoverStoppedRun()).toBe(true);
  expect(turnLog(reopened,'t1').outcome).toMatchObject({status:'interrupted',ending:STOPPED_WHEN_CLOSED});
 });
 it('stays under the size the gateway takes',()=>{
  const {db,folder}=project();mkdirSync(join(folder,'Workspace'),{recursive:true});
  for(let n=0;n<30;n++)writeFileSync(join(folder,'Workspace',`scene${n}.tsx`),'x'.repeat(100_000));
  db.saveState('agent-session',{id:'s',model:'m',auto:false,effort:'auto',known:[],compactions:0,createdAt:'x',turns:{t1:0},journalEpoch:1,messages:Array.from({length:600},(_,n)=>({role:n%2?'assistant':'user',content:[{type:'text',text:`step ${n} `+'y'.repeat(5000)}]}))});
  const log=turnLog(db,'t1'),size=JSON.stringify(log).length;
  expect(size).toBeLessThan(1_500_000);expect(log.shortened).toBe(true);
  // How the request began and ended stays.
  expect(log.outcome.status).toBe('complete');expect(log.request).toBe('Cut the boring parts');
  const main=log.conversation.find((p:any)=>p.phase==='main');expect(main.messages[0].content[0].text).toMatch(/^step 0 /);expect(main.messages.at(-1).content[0].text).toMatch(/^step 599 /);
 });
});
