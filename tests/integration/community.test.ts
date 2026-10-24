import {describe,it,expect,beforeAll} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {randomUUID} from 'node:crypto';
import {supabaseDb} from '../fixtures/supabase-db';

/** The community page's rules (supabase/migrations/202610240001_community.sql), as the page meets them: PostgREST runs
 * each request as anon or authenticated with the visitor's id, and Gumbo's scripts write as the database owner. */
let db:PGlite;const owner=randomUUID(),maya=randomUUID(),sam=randomUUID();
/** Runs SQL as a visitor (null: signed out), the way PostgREST does, inside a transaction it rolls back on error. */
async function as<T=any>(who:string|null,sql:string,params:unknown[]=[]):Promise<T[]>{
 await db.exec('begin');
 try{
  await db.query(`select set_config('request.jwt.claim.sub',$1,true)`,[who??'']);await db.exec(`set local role ${who?'authenticated':'anon'}`);
  const result=await db.query<T>(sql,params);await db.exec('commit');return result.rows;
 }catch(error){await db.exec('rollback');throw error;}
}
beforeAll(async()=>{
 db=await supabaseDb();
 await db.query(`insert into auth.users(id,email,raw_user_meta_data) values($1,'yuanchengli612@gmail.com','{"full_name":"Yuancheng Li"}'),($2,'maya@example.com','{"full_name":"Maya Rivera"}'),($3,'sam@example.com','{}')`,[owner,maya,sam]);
 for(const [id,email] of [[owner,'yuanchengli612@gmail.com'],[maya,'maya@example.com'],[sam,'sam@example.com']])await db.query('select public.dream_activate_account($1,$2)',[id,email]);
},120_000);

describe('the community board',()=>{
 it('lets a signed-in person post as themselves, open, under their name and never their email',async()=>{
  const [post]=await as(maya,`insert into dream_community_posts(kind,title,body,status) values('idea','Export to TikTok directly','Would save me a step.','shipped') returning *`);
  expect(post).toMatchObject({author:maya,author_name:'Maya Rivera',kind:'idea',status:'open',votes:0,replies:0});
  const [anonymous]=await as(sam,`insert into dream_community_posts(kind,title) values('bug','Preview stutters') returning author_name`);
  expect(anonymous.author_name).toBe('Gumbo user');
  // Read by anyone, signed in or not.
  expect((await as(null,`select title from dream_community_posts order by created_at`)).map(p=>p.title)).toEqual(['Export to TikTok directly','Preview stutters']);
 });
 it('keeps updates, statuses and other people’s posts to the owner',async()=>{
  await expect(as(null,`insert into dream_community_posts(kind,title) values('idea','Signed out')`)).rejects.toThrow();
  await expect(as(maya,`insert into dream_community_posts(kind,title) values('update','Fake release notes')`)).rejects.toThrow(/Only Gumbo posts updates/);
  const [{id}]=await as(null,`select id from dream_community_posts where title='Export to TikTok directly'`);
  await as(maya,`update dream_community_posts set status='shipped',title='Export straight to TikTok' where id=$1`,[id]);
  expect((await as(null,`select status,title from dream_community_posts where id=$1`,[id]))[0]).toEqual({status:'open',title:'Export straight to TikTok'});
  await expect(as(sam,`update dream_community_posts set title='Mine now' where id=$1`,[id])).resolves.toEqual([]);
  expect((await as(null,`select title from dream_community_posts where id=$1`,[id]))[0].title).toBe('Export straight to TikTok');
  // The owner sets the status, posts updates (signed "Gumbo") and can remove anything.
  await as(owner,`update dream_community_posts set status='planned' where id=$1`,[id]);
  expect((await as(null,`select status from dream_community_posts where id=$1`,[id]))[0].status).toBe('planned');
  const [update]=await as(owner,`insert into dream_community_posts(kind,title,body) values('update','Faster exports','Motion graphics export 3x faster.') returning author_name,status`);
  expect(update).toEqual({author_name:'Gumbo',status:'open'});
 });
 it('counts votes and replies, one vote each, which only the voter sees',async()=>{
  const [{id}]=await as(null,`select id from dream_community_posts where title='Export straight to TikTok'`);
  await as(sam,`insert into dream_community_votes(post_id) values($1)`,[id]);await as(owner,`insert into dream_community_votes(post_id) values($1)`,[id]);
  await expect(as(sam,`insert into dream_community_votes(post_id) values($1)`,[id])).rejects.toThrow();
  await expect(as(sam,`insert into dream_community_votes(post_id,voter) values($1,$2)`,[id,maya])).rejects.toThrow();
  expect((await as(null,`select votes from dream_community_posts where id=$1`,[id]))[0].votes).toBe(2);
  expect(await as(maya,`select * from dream_community_votes`)).toEqual([]);
  await as(sam,`delete from dream_community_votes where post_id=$1`,[id]);
  expect((await as(null,`select votes from dream_community_posts where id=$1`,[id]))[0].votes).toBe(1);
  const [reply]=await as(sam,`insert into dream_community_replies(post_id,body) values($1,'Same here!') returning author,author_name`,[id]);
  expect(reply).toEqual({author:sam,author_name:'Gumbo user'});
  await as(owner,`insert into dream_community_replies(post_id,body) values($1,'On the list.')`,[id]);
  expect((await as(null,`select replies from dream_community_posts where id=$1`,[id]))[0].replies).toBe(2);
  expect((await as(null,`select author_name,body from dream_community_replies where post_id=$1 order by created_at`,[id])).map(r=>r.author_name)).toEqual(['Gumbo user','Gumbo']);
  // Someone else's reply stays; the owner removes it.
  expect(await as(maya,`delete from dream_community_replies where post_id=$1 and author=$2 returning id`,[id,sam])).toEqual([]);
  await as(owner,`delete from dream_community_replies where post_id=$1 and author=$2`,[id,sam]);
  expect((await as(null,`select replies from dream_community_posts where id=$1`,[id]))[0].replies).toBe(1);
 });
 it('takes changelog entries from Gumbo’s scripts, once per slug',async()=>{
  await db.query(`insert into dream_community_posts(kind,title,body,slug,created_at) values('update','Gumbo on the web','Edit in your browser.','2026-10-23-web','2026-10-23T12:00:00Z') on conflict(slug) do update set title=excluded.title,body=excluded.body`);
  await db.query(`insert into dream_community_posts(kind,title,body,slug,created_at) values('update','Gumbo on the web','Edit in Chrome or Edge.','2026-10-23-web','2026-10-23T12:00:00Z') on conflict(slug) do update set title=excluded.title,body=excluded.body`);
  expect(await as(null,`select author_name,body,created_at from dream_community_posts where slug='2026-10-23-web'`)).toEqual([{author_name:'Gumbo',body:'Edit in Chrome or Edge.',created_at:new Date('2026-10-23T12:00:00Z')}]);
 });
 it('limits how much one account posts in an hour',async()=>{
  for(let n=0;n<9;n++)await as(sam,`insert into dream_community_posts(kind,title) values('question',$1)`,[`Question ${n}`]);
  await expect(as(sam,`insert into dream_community_posts(kind,title) values('question','One too many')`)).rejects.toThrow(/a lot of posts/);
 });
});
