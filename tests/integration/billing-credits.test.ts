import {describe,it,expect,beforeAll} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {randomUUID} from 'node:crypto';
import {supabaseDb} from '../fixtures/supabase-db';

/** Credits in the gateway's database (supabase/migrations/202610170003_billing.sql): a free month's grant, requests taking
 * their real cost, running out, top-ups paying an overdraft, plan periods replacing each other. */
let db:PGlite;
// Daily spending limits have their own tests (spend-limits.test.ts); these spend freely to test credits alone.
beforeAll(async()=>{db=await supabaseDb();await db.query('update dream_limits set account_daily_usd=1000,global_daily_usd=100000');},60000);
const account=async(guest=false)=>{const id=randomUUID();await db.query('insert into auth.users(id,email) values($1,$2)',[id,id+'@test']);await db.query('insert into dream_accounts(id,email,is_guest) values($1,$2,$3)',[id,id+'@test',guest]);return id;};
const balance=async(user:string)=>Number((await db.query<{b:string}>('select dream_credit_balance($1) as b',[user])).rows[0].b);
const reserve=(user:string)=>{const request=randomUUID();return db.query<{id:string}>("select dream_reserve_usage($1,$2,'turn','claude-haiku-5-5',0.5) as id",[user,request]).then(r=>r.rows[0].id);};
const finish=(usage:string,cost:number)=>db.query("update dream_usage set status='completed',cost_usd=$2 where id=$1",[usage,cost]);
const grant=(user:string,kind:string,plan:string|null,credits:number,source:string,expires:string|null=null)=>db.query<{ok:boolean}>('select dream_grant_credits($1,$2,$3,$4,$5,now(),$6::timestamptz) as ok',[user,kind,plan,credits,source,expires]).then(r=>r.rows[0].ok);

describe('credits',()=>{
 it('gives a free account its month on its first request, and each request takes its cost in cents',async()=>{
  const user=await account();expect(await balance(user)).toBe(0);
  const usage=await reserve(user);expect(await balance(user)).toBe(20);
  await finish(usage,0.15);expect(await balance(user)).toBe(5);
  const {rows}=await db.query<{credits:string}>('select credits from dream_usage where id=$1',[usage]);expect(Number(rows[0].credits)).toBe(15);
  // The month is granted once: another request does not add to it.
  await finish(await reserve(user),0);expect(await balance(user)).toBe(5);
 });
 it('lets the last request run over, then refuses until a top-up pays the overdraft',async()=>{
  const user=await account();await finish(await reserve(user),1.2);expect(await balance(user)).toBe(-100);
  await expect(reserve(user)).rejects.toThrow(/used all your credits/);
  expect(await grant(user,'topup',null,500,'cs_test_'+user)).toBe(true);expect(await balance(user)).toBe(400);
  // Stripe may send the same event twice: the second grant is refused.
  expect(await grant(user,'topup',null,500,'cs_test_'+user)).toBe(false);expect(await balance(user)).toBe(400);
  await expect(reserve(user)).resolves.toBeTruthy();
 });
 it('spends the plan before top-ups, and a new plan period replaces the last one',async()=>{
  const user=await account();await db.query("update dream_accounts set plan='pro' where id=$1",[user]);
  await grant(user,'topup',null,500,'cs_'+user);await grant(user,'plan','pro',900,'in_1_'+user,new Date(Date.now()+30*864e5).toISOString());
  await finish(await reserve(user),2);
  const left=async(kind:string)=>Number((await db.query<{r:string}>('select sum(remaining) as r from dream_credit_grants where user_id=$1 and kind=$2 and (expires_at is null or expires_at>now())',[user,kind])).rows[0].r??0);
  expect(await left('plan')).toBe(700);expect(await left('topup')).toBe(500);
  // The renewal: the old period's 700 end, the new period's 900 begin; the top-up stays.
  await grant(user,'plan','pro',900,'in_2_'+user,new Date(Date.now()+60*864e5).toISOString());
  expect(await left('plan')).toBe(900);expect(await balance(user)).toBe(1400);
 });
 it('gives credits back when a recorded cost goes down',async()=>{
  const user=await account();const usage=await reserve(user);await finish(usage,0.2);expect(await balance(user)).toBe(0);
  await finish(usage,0.1);expect(await balance(user)).toBe(10);
 });
 it('gives no free credits to a paid account or a guest',async()=>{
  const paid=await account();await db.query("update dream_accounts set plan='max' where id=$1",[paid]);
  await expect(reserve(paid)).rejects.toThrow(/used all your credits/);
  // A guest has only the try's gift (try-share-feedback.test.ts): without it, it is asked to sign in.
  const guest=await account(true);await expect(reserve(guest)).rejects.toThrow(/free try\. Sign in/);
 });
});
