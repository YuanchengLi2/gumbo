import {describe,it,expect,beforeAll} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {randomUUID} from 'node:crypto';
import {supabaseDb} from '../fixtures/supabase-db';
import {handleEditLog,MAX_EDIT_LOG_BYTES,type EditLogPorts} from '../../supabase/functions/dream-gateway/edit-logs';

/** Every request's log, kept by the gateway (supabase/migrations/202610210002_edit_logs.sql): one row per request with the
 * account, the app's version and the request's id, a later run replacing an earlier one, the same run never twice. */
let db:PGlite;
beforeAll(async()=>{db=await supabaseDb();},60000);
const account=async()=>{const id=randomUUID();await db.query('insert into auth.users(id,email) values($1,$2)',[id,id+'@test']);await db.query('insert into dream_accounts(id,email) values($1,$2)',[id,id+'@test']);return id;};
const ports=(limit?:number):EditLogPorts=>({record:async(row,dailyLimit)=>(await db.query<{r:string}>('select dream_record_edit_log($1::jsonb,$2) as r',[JSON.stringify(row),limit??dailyLimit])).rows[0].r as any});
const log=(turnId:string,run:string,status='complete',extra:Record<string,unknown>={})=>({version:2,turnId,project:{name:'Trip'},request:'Cut the boring parts',
 outcome:{status,ending:'Done.'},timing:{startedAt:'2026-10-21T10:00:00.000Z',runStartedAt:run,endedAt:'2026-10-21T10:02:00.000Z',durationMs:120000,modelMs:80000},
 cost:{usd:0.1234,credits:12.3,calls:9},totals:[{model:'deepseek-v4.1-flash',calls:8,costUsd:0.1},{model:'claude-haiku-5-5',calls:1,costUsd:0.0234}],
 tools:[{tool:'read_file',status:'complete'},{tool:'publish_project',status:'failed',error:'Scene crashed'}],...extra});
const send=(user:string,turnId:string,run:string,status?:string,p=ports())=>handleEditLog({key:`${turnId}@${run}`,turnId,appVersion:'0.2.4',platform:'win32 x64',training:false,log:log(turnId,run,status)},user,p);
const row=async(user:string,turnId:string)=>(await db.query<any>('select * from dream_edit_logs where user_id=$1 and turn_id=$2',[user,turnId])).rows[0];

describe('edit logs on the gateway',()=>{
 it('keeps a request once with its account, version and what it is studied by',async()=>{
  const user=await account();
  expect(await send(user,'t1','2026-10-21T10:00:00.000Z')).toEqual({status:200,body:{kept:'stored'}});
  const kept=await row(user,'t1');
  expect(kept).toMatchObject({user_id:user,turn_id:'t1',app_version:'0.2.4',platform:'win32 x64',project:'Trip',request:'Cut the boring parts',status:'complete',calls:9,tool_calls:2,tool_errors:1,runs:1,training:false,models:['deepseek-v4.1-flash','claude-haiku-5-5']});
  expect(Number(kept.cost_usd)).toBe(0.1234);expect(Number(kept.credits)).toBe(12.3);expect(Number(kept.duration_ms)).toBe(120000);
  expect(kept.log.outcome.status).toBe('complete');expect(kept.size_bytes).toBeGreaterThan(100);
  // The same run sent again (a retry after the answer was lost) changes nothing.
  expect(await send(user,'t1','2026-10-21T10:00:00.000Z','failed')).toEqual({status:200,body:{kept:'duplicate'}});
  expect((await row(user,'t1')).status).toBe('complete');
  expect((await db.query('select 1 from dream_edit_logs where turn_id=$1',['t1'])).rows).toHaveLength(1);
 });
 it('replaces a request with its later run, and never with an earlier one',async()=>{
  const user=await account();
  await send(user,'t2','2026-10-21T10:00:00.000Z','stopped');
  expect((await send(user,'t2','2026-10-21T10:05:00.000Z','complete')).body).toEqual({kept:'updated'});
  expect(await row(user,'t2')).toMatchObject({status:'complete',runs:2,run_key:'t2@2026-10-21T10:05:00.000Z'});
  expect((await send(user,'t2','2026-10-21T10:00:00.000Z','stopped')).body).toEqual({kept:'older'});
  expect(await row(user,'t2')).toMatchObject({status:'complete',runs:2});
  // Another account's request with the same id is its own row.
  const other=await account();expect((await send(other,'t2','2026-10-21T10:00:00.000Z')).body).toEqual({kept:'stored'});
 });
 it('refuses a log that is missing, too large, or past the daily limit',async()=>{
  const user=await account();
  expect((await handleEditLog({turnId:'t3',key:'t3@x'},user,ports())).status).toBe(400);
  expect((await handleEditLog({turnId:'t3',key:'t3@x',log:log('t3','x','complete',{files:[{text:'x'.repeat(MAX_EDIT_LOG_BYTES)}]})},user,ports())).status).toBe(413);
  expect((await send(user,'t4','2026-10-21T10:00:00.000Z',undefined,ports(1))).status).toBe(200);
  expect((await send(user,'t5','2026-10-21T10:00:00.000Z',undefined,ports(1))).status).toBe(429);
  expect(await row(user,'t5')).toBeUndefined();
 });
 it('is kept from the app and the public: only the gateway reads it',async()=>{
  const grants=await db.query("select grantee from information_schema.role_table_grants where table_name='dream_edit_logs' and grantee in ('anon','authenticated')");
  expect(grants.rows).toHaveLength(0);
  const rls=await db.query<{r:boolean}>("select relrowsecurity as r from pg_class where relname='dream_edit_logs'");expect(rls.rows[0].r).toBe(true);
 });
});
