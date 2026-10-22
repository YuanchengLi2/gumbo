import {describe,it,expect,beforeAll} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {randomUUID} from 'node:crypto';
import {supabaseDb} from '../fixtures/supabase-db';

/** The open beta's spending limits (supabase/migrations/202610220002_spend_limits.sql): a request is refused once its
 * account has spent its daily limit, or once all accounts together have spent the day's limit; the owner is exempt. */
let db:PGlite;
beforeAll(async()=>{db=await supabaseDb();},60000);
const account=async(admin=false)=>{const id=randomUUID();await db.query('insert into auth.users(id,email) values($1,$2)',[id,id+'@test']);await db.query('insert into dream_accounts(id,email,is_admin) values($1,$2,$3)',[id,id+'@test',admin]);return id;};
const reserve=(user:string,usd:number)=>db.query<{id:string}>("select dream_reserve_usage($1,$2,'turn','claude-haiku-5-5',$3) as id",[user,randomUUID(),usd]).then(r=>r.rows[0].id);
const finish=(usage:string,cost:number)=>db.query("update dream_usage set status='completed',cost_usd=$2 where id=$1",[usage,cost]);
const limits=(account:number,global:number)=>db.query('update dream_limits set account_daily_usd=$1,global_daily_usd=$2',[account,global]);
const refused=(promise:Promise<unknown>)=>promise.then(()=>null,(error:any)=>error.code as string);

describe('spending limits',()=>{
 it('refuses an account past its daily limit, counting running requests by what they reserved',async()=>{
  await limits(1,1000);const user=await account();
  await finish(await reserve(user,0.5),0.08);await reserve(user,0.5);          // 0.08 spent + 0.5 still running
  expect(await refused(reserve(user,0.4))).toBe(null);                          // 0.98 of 1
  expect(await refused(reserve(user,0.1))).toBe('D0003');
 });
 it('refuses everyone but the owner once all accounts together reach the day\'s limit',async()=>{
  const [a,b,owner]=[await account(),await account(),await account(true)];
  const {rows}=await db.query<{s:string}>("select coalesce(sum(case when status='reserved' then greatest(cost_usd,reserved_usd) else cost_usd end),0) as s from dream_usage");
  await limits(1,Number(rows[0].s)+0.3);
  await reserve(a,0.2);
  expect(await refused(reserve(b,0.2))).toBe('D0006');
  expect(await refused(reserve(owner,5))).toBe(null);
 });
 it('keeps the limits away from signed-in users and visitors',async()=>{
  const {rows}=await db.query<{relrowsecurity:boolean}>("select relrowsecurity from pg_class where relname='dream_limits'");expect(rows[0].relrowsecurity).toBe(true);
 });
});
