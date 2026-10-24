import {describe,it,expect,beforeAll} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {randomUUID} from 'node:crypto';
import {supabaseDb} from '../fixtures/supabase-db';
import {handleFeedback,MAX_FEEDBACK_PER_HOUR,type FeedbackRow} from '../../supabase/functions/dream-gateway/feedback';
import {shareStory} from '../../supabase/functions/dream-gateway/share';

/** Trying Gumbo without an account, share links that show how an edit was made, and feedback from under the prompt box
 * (supabase/migrations/202610240002_try_share_feedback.sql and the gateway's feedback.ts and share.ts). */
let db:PGlite;
beforeAll(async()=>{db=await supabaseDb();},60000);
const guest=async()=>{const id=randomUUID();await db.query('insert into auth.users(id,is_anonymous) values($1,true)',[id]);
 const {rows}=await db.query<{ok:boolean}>('select dream_activate_guest($1) as ok',[id]);expect(rows[0].ok).toBe(true);return id;};
const balance=async(user:string)=>Number((await db.query<{b:string}>('select dream_credit_balance($1) as b',[user])).rows[0].b);
const reserve=(user:string,usd:number)=>db.query<{id:string}>("select dream_reserve_usage($1,$2,'turn','claude-haiku-5-5',$3) as id",[user,randomUUID(),usd]).then(r=>r.rows[0].id);
const finish=(usage:string,cost:number)=>db.query("update dream_usage set status='completed',cost_usd=$2 where id=$1",[usage,cost]);

describe('a guest try',()=>{
 it('gives an anonymous session a one-time gift of credits that expires in a week',async()=>{
  const user=await guest();expect(await balance(user)).toBe(25);
  await db.query('select dream_activate_guest($1)',[user]);expect(await balance(user)).toBe(25);
  const {rows}=await db.query<{days:number}>("select extract(day from expires_at-now())::int as days from dream_credit_grants where user_id=$1",[user]);expect(rows[0].days).toBeGreaterThanOrEqual(6);
 });
 it('refuses a signed-in identity as a guest',async()=>{const id=randomUUID();await db.query('insert into auth.users(id,email) values($1,$2)',[id,id+'@test']);
  expect((await db.query<{ok:boolean}>('select dream_activate_guest($1) as ok',[id])).rows[0].ok).toBe(false);});
 it('ends the try when the gift is spent, asking to sign in',async()=>{
  const user=await guest();await finish(await reserve(user,.1),.3);
  await expect(reserve(user,.1)).rejects.toThrow(/free try\. Sign in/);
 });
 it('caps what all guests spend in a day, and leaves signed-in accounts alone',async()=>{
  // Other tests' guests spent today too: the cap is set half a dollar above what they spent.
  const {rows:[spent]}=await db.query<{usd:string}>('select coalesce(sum(u.cost_usd),0) as usd from dream_usage u join dream_accounts a on a.id=u.user_id where a.is_guest');
  await db.query('update dream_limits set guest_daily_usd=$1',[Number(spent.usd)+.5]);
  try{
   const a=await guest(),b=await guest();await finish(await reserve(a,.1),.2);await finish(await reserve(b,.1),.2);
   const c=await guest();await expect(reserve(c,.2)).rejects.toThrow(/Free tries are full/);
   const member=randomUUID();await db.query('insert into auth.users(id,email) values($1,$2)',[member,member+'@test']);await db.query('insert into dream_accounts(id,email) values($1,$2)',[member,member+'@test']);
   expect(await reserve(member,.2)).toBeTruthy();
  }finally{await db.query('update dream_limits set guest_daily_usd=3');}
 });
});

describe('share links',()=>{
 it('keep the prompts, the footage it was made from and the length, cleaned',()=>{
  const still='data:image/jpeg;base64,'+'A'.repeat(100);
  const story=shareStory({prompts:['  cut the ums ','',7,'x'.repeat(5000),...Array(10).fill('more')],source:{clips:3.7,durationSec:2412.345,stills:[still,'javascript:alert(1)','data:image/jpeg;base64,'+'A'.repeat(90_000),still]},durationSec:31.5});
  expect(story.prompts[0]).toBe('cut the ums');expect(story.prompts[1]).toHaveLength(1000);expect(story.prompts).toHaveLength(8);
  expect(story.source).toEqual({clips:3,durationSec:2412.34,stills:[still,still]});expect(story.durationSec).toBe(31.5);
  expect(shareStory({}).source).toBeNull();expect(shareStory({source:{durationSec:'nope'}}).source).toBeNull();
 });
 it('have room for the story in the database',async()=>{
  const {rows}=await db.query<{column_name:string}>("select column_name from information_schema.columns where table_name='dream_shares'");
  expect(rows.map(r=>r.column_name)).toEqual(expect.arrayContaining(['prompts','source','duration_sec','views']));
 });
});

describe('feedback',()=>{
 const ports=()=>{const rows:FeedbackRow[]=[],alerts:FeedbackRow[]=[];return{rows,alerts,sentFrom:async(address:string)=>rows.filter(r=>r.address===address).length,insert:async(row:FeedbackRow)=>{rows.push(row);},alert:async(row:FeedbackRow)=>{alerts.push(row);}};};
 it('takes a note with or without an account, and an email to hear back on',async()=>{
  const p=ports();
  expect(await handleFeedback({note:' The captions prompt failed ',email:'Sam@Example.com',context:{aiStatus:'failed',lastRequest:'add captions',nested:{a:1},huge:'y'.repeat(900)},appVersion:'0.3.0',platform:'web Win32'},'1.2.3.4',null,p)).toEqual({status:200,body:{sent:true}});
  expect(p.rows[0]).toMatchObject({user_id:null,email:'sam@example.com',note:'The captions prompt failed',context:{aiStatus:'failed',lastRequest:'add captions'}});
  expect((p.rows[0].context.huge as string).length).toBe(500);expect(p.rows[0].context.nested).toBeUndefined();expect(p.rows[0].address).not.toContain('1.2.3.4');
  expect(p.alerts).toHaveLength(1);
  await handleFeedback({note:'again'},'1.2.3.4','user-1',p);expect(p.rows[1]).toMatchObject({user_id:'user-1',email:null});
 });
 it('needs a note, a real email when one is given, and limits each address',async()=>{
  const p=ports();
  expect((await handleFeedback({note:'  '},'a',null,p)).status).toBe(400);
  expect((await handleFeedback({note:'hi',email:'not-an-email'},'a',null,p)).status).toBe(400);
  for(let n=0;n<MAX_FEEDBACK_PER_HOUR;n++)expect((await handleFeedback({note:'n'+n},'a',null,p)).status).toBe(200);
  expect((await handleFeedback({note:'one more'},'a',null,p)).status).toBe(429);
  expect((await handleFeedback({note:'elsewhere'},'b',null,p)).status).toBe(200);
 });
 it('answers a bot as if it sent, keeping nothing',async()=>{const p=ports();expect((await handleFeedback({note:'buy now',website:'spam.example'},'c',null,p)).status).toBe(200);expect(p.rows).toHaveLength(0);});
 it('has a table only the gateway can reach',async()=>{const {rows}=await db.query<{n:number}>("select count(*)::int as n from information_schema.tables where table_name='dream_feedback'");expect(rows[0].n).toBe(1);});
});
