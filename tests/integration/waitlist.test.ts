import {describe,it,expect,beforeAll} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {randomUUID} from 'node:crypto';
import {supabaseDb} from '../fixtures/supabase-db';
import {handleWaitlistJoin,MAX_JOINS_PER_HOUR,WAITLISTED,type WaitlistPorts,type WaitlistRow} from '../../supabase/functions/dream-gateway/waitlist';
import {handleSpendDashboard,type SpendPorts,type WaitlistEntry} from '../../supabase/functions/dream-gateway/spend-dashboard';

/** The paid beta's waitlist: joining on usegumbo.app, inviting on the dashboard, and which accounts may use the AI
 * (supabase/migrations/202610180004_waitlist.sql). */
const memory=()=>{const rows:(WaitlistRow&{at:number})[]=[];const ports:WaitlistPorts={joinedFrom:async(address,since)=>rows.filter(r=>r.address===address&&r.at>=since.getTime()).length,join:async row=>{if(!rows.some(r=>r.email===row.email))rows.push({...row,at:Date.now()});}};return {rows,ports};};

describe('joining the waitlist',()=>{
 it('keeps the email and first ask, once, and refuses a bad email',async()=>{
  const {rows,ports}=memory();
  expect(await handleWaitlistJoin({email:' Maya@Example.com ',firstAsk:'A recap of my trip',source:'bottom'},'1.2.3.4',ports)).toEqual({status:200,body:{joined:true}});
  await handleWaitlistJoin({email:'maya@example.com',firstAsk:'Something else'},'5.6.7.8',ports);
  expect(rows).toHaveLength(1);expect(rows[0]).toMatchObject({email:'maya@example.com',first_ask:'A recap of my trip',source:'bottom'});expect(rows[0].address).toMatch(/^[0-9a-f]{64}$/);
  expect((await handleWaitlistJoin({email:'not an email'},'1.2.3.4',ports)).status).toBe(400);
 });
 it('answers a bot that fills the hidden field as if it joined, and limits one address',async()=>{
  const {rows,ports}=memory();
  expect((await handleWaitlistJoin({email:'bot@spam.com',website:'http://spam'},'9.9.9.9',ports)).status).toBe(200);expect(rows).toHaveLength(0);
  for(let n=0;n<MAX_JOINS_PER_HOUR;n++)expect((await handleWaitlistJoin({email:`p${n}@example.com`},'9.9.9.9',ports)).status).toBe(200);
  expect((await handleWaitlistJoin({email:'one-more@example.com'},'9.9.9.9',ports)).status).toBe(429);
  expect((await handleWaitlistJoin({email:'elsewhere@example.com'},'8.8.8.8',ports)).status).toBe(200);
 });
});

describe('inviting on the dashboard',()=>{
 it('invites an email and lists the waitlist with who has signed up',async()=>{
  const invited:string[]=[],entries:WaitlistEntry[]=[{email:'maya@example.com',first_ask:'A recap of my trip',source:'bottom',created_at:'2026-10-18T20:00:00Z',invited_at:null,signed_up:false,beta_access:false}];
  const ports:SpendPorts={password:'pw',calls:async()=>[],accounts:async()=>[],failures:async()=>0,fail:async()=>{},waitlist:async()=>entries,invite:async email=>{invited.push(email);entries[0].invited_at='2026-10-18T21:00:00Z';}};
  const listed=await handleSpendDashboard({password:'pw'},'1.1.1.1',ports);
  expect((listed.body as any).waitlist).toEqual([{email:'maya@example.com',firstAsk:'A recap of my trip',source:'bottom',joined:'2026-10-18T20:00:00.000Z',invited:null,signedUp:false,access:false}]);
  const after=await handleSpendDashboard({password:'pw',invite:'Maya@Example.com'},'1.1.1.1',ports);
  expect(invited).toEqual(['maya@example.com']);expect((after.body as any).waitlist[0].invited).toBe('2026-10-18T21:00:00.000Z');
  expect((await handleSpendDashboard({password:'pw',invite:'nope'},'1.1.1.1',ports)).status).toBe(400);
  // Inviting needs the password like everything else.
  expect((await handleSpendDashboard({password:'wrong',invite:'x@example.com'},'1.1.1.1',ports)).status).toBe(401);expect(invited).toHaveLength(1);
 });
 it('says plainly why an account cannot edit yet',()=>{expect(WAITLISTED).toMatch(/waitlist/);});
});

describe('beta access in the database',()=>{
 let db:PGlite;
 beforeAll(async()=>{db=await supabaseDb();},60000);
 const user=async(email:string)=>{const id=randomUUID();await db.query('insert into auth.users(id,email) values($1,$2)',[id,email]);return id;};
 const activate=(id:string,email:string)=>db.query<{ok:boolean}>('select dream_activate_account($1,$2) as ok',[id,email]).then(r=>r.rows[0].ok);
 const access=(id:string)=>db.query<{beta_access:boolean}>('select beta_access from dream_accounts where id=$1',[id]).then(r=>r.rows[0]?.beta_access);
 it('lets anyone sign in, but only invited emails and the owner use the AI; an invite after signing up counts',async()=>{
  const stranger=await user('stranger@example.com');expect(await activate(stranger,'stranger@example.com')).toBe(true);expect(await access(stranger)).toBe(false);
  await db.query("insert into dream_invites(email) values('friend@example.com')");
  const friend=await user('friend@example.com');expect(await activate(friend,'Friend@Example.com')).toBe(true);expect(await access(friend)).toBe(true);
  const owner=await user('yuanchengli612@gmail.com');await activate(owner,'yuanchengli612@gmail.com');expect(await access(owner)).toBe(true);
  // Invited later (from the dashboard): the next request activates their access.
  await db.query("insert into dream_invites(email) values('stranger@example.com')");await activate(stranger,'stranger@example.com');expect(await access(stranger)).toBe(true);
 });
 it('keeps the waitlist out of reach of signed-in users and visitors',async()=>{
  const {rows}=await db.query<{relrowsecurity:boolean}>("select relrowsecurity from pg_class where relname='dream_waitlist'");expect(rows[0].relrowsecurity).toBe(true);
 });
});
