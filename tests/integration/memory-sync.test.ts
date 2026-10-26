import {describe,it,expect,beforeAll} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {randomUUID} from 'node:crypto';
import {supabaseDb} from '../fixtures/supabase-db';
import {handleMemorySync,readSyncProfile,type MemorySyncPorts} from '../../supabase/functions/dream-gateway/memory-sync';

/** Gumbo for Chrome's synced memory on the gateway (supabase/migrations/202610260001_memory_sync.sql), through the
 * gateway's handler over the migration's functions: last write wins per record, the same version twice changes nothing,
 * a full account stops taking records, pulls come in order a few megabytes at a time, a new key stops the old one, and
 * a signed-in user can read only their own ciphertext. */
let db:PGlite;
beforeAll(async()=>{db=await supabaseDb();},60000);
const account=async()=>{const id=randomUUID();await db.query('insert into auth.users(id,email) values($1,$2)',[id,id+'@test']);await db.query('insert into dream_accounts(id,email) values($1,$2)',[id,id+'@test']);return id;};
const one=async(sql:string,args:unknown[])=>(await db.query<{r:any}>(sql,args)).rows[0].r;
const ports:MemorySyncPorts={
 profile:user=>one('select dream_memory_sync_profile($1) as r',[user]),
 create:(user,p)=>one('select dream_memory_sync_setup($1,$2,$3,$4::jsonb,$5) as r',[user,p.key_id,p.salt,JSON.stringify(p.kdf),p.verifier]),
 reset:async user=>{await db.query('select dream_memory_sync_reset($1)',[user]);},
 push:async(user,keyId,rows)=>{const r=await one('select dream_memory_sync_push($1,$2,$3::jsonb) as r',[user,keyId,JSON.stringify(rows)]);return r.error?null:r;},
 pull:async(user,keyId,since,limit,maxBytes)=>{const r=await one('select dream_memory_sync_pull($1,$2,$3,$4,$5) as r',[user,keyId,since,limit,maxBytes]);return r.error?null:r;},
};
const KEY='k'.repeat(32),profile={keyId:KEY,salt:'c2FsdHNhbHRzYWx0c2FsdA==',kdf:{name:'PBKDF2',hash:'SHA-256',iterations:600000},verifier:'dmVyaWZpZXI='};
const row=(sid:string,at:number,device='aaaa1111',payload='c2VhbGVk',version=1)=>({sid,at,device,version,payload});
const send=(user:string,rows:unknown[],keyId=KEY)=>handleMemorySync('memory-sync-push',{keyId,rows},user,ports);
const fetchAll=async(user:string,since=0,limit=500)=>(await handleMemorySync('memory-sync-pull',{keyId:KEY,since,limit},user,ports)).body as any;

describe('synced memory on the gateway',()=>{
 it('keeps one key profile per account, and none until one is set up',async()=>{
  const user=await account();
  expect((await readSyncProfile(user,ports)).body).toEqual({profile:null,bytes:0,limit:null});
  expect(await handleMemorySync('memory-sync-setup',profile,user,ports)).toEqual({status:200,body:{created:true}});
  expect((await readSyncProfile(user,ports)).body).toEqual({profile,bytes:0,limit:268435456});
  const again=await handleMemorySync('memory-sync-setup',{...profile,keyId:'z'.repeat(32)},user,ports);
  expect(again.status).toBe(409);expect((again.body as any).profile.keyId).toBe(KEY);
  expect((await handleMemorySync('memory-sync-setup',{...profile,kdf:{name:'PBKDF2',hash:'SHA-256',iterations:1000}},await account(),ports)).status).toBe(400);
 });
 it('keeps the newer version of each record, and the same version sent twice once',async()=>{
  const user=await account();await handleMemorySync('memory-sync-setup',profile,user,ports);
  expect((await send(user,[row('sid-aaaa',100),row('sid-bbbb',100)])).body).toMatchObject({applied:2,taken:2,older:[],full:false});
  // Older, the same again, and a tie on time lost to the higher computer id: none of them replace what is there.
  expect((await send(user,[row('sid-aaaa',99,'aaaa1111','b2xk'),row('sid-bbbb',100)])).body).toMatchObject({applied:0,taken:2,older:['sid-aaaa','sid-bbbb']});
  expect((await send(user,[row('sid-aaaa',100,'0000aaaa','dGll')])).body).toMatchObject({applied:0,taken:1,older:['sid-aaaa']});
  // Newer by time, by computer id at the same time, and by version on the same computer: each replaces it.
  expect((await send(user,[row('sid-aaaa',101,'aaaa1111','bmV3ZXI='),row('sid-bbbb',100,'bbbb2222','Yg=='),row('sid-cccc',5)])).body).toMatchObject({applied:3});
  expect((await send(user,[row('sid-cccc',5,'aaaa1111','djI=',2)])).body).toMatchObject({applied:1});
  const all=await fetchAll(user);
  expect(all.rows.map((r:any)=>[r.sid,r.at,r.device,r.payload])).toEqual([['sid-aaaa',101,'aaaa1111','bmV3ZXI='],['sid-bbbb',100,'bbbb2222','Yg=='],['sid-cccc',5,'aaaa1111','djI=']]);
  expect(all.more).toBe(false);
  // seq follows what was taken last, so a pull after the first one sees only what changed.
  expect((await fetchAll(user,all.rows.at(-1).seq)).rows).toEqual([]);
 });
 it('pulls in order, a few at a time and never more than the byte limit (always at least one)',async()=>{
  const user=await account();await handleMemorySync('memory-sync-setup',profile,user,ports);
  await send(user,Array.from({length:7},(_,i)=>row('sid-'+String(i).padStart(4,'0'),i+1,'aaaa1111','QUFB'.repeat(250))));
  const first=await fetchAll(user,0,3);expect(first.rows.map((r:any)=>r.sid)).toEqual(['sid-0000','sid-0001','sid-0002']);expect(first.more).toBe(true);
  const rest=await fetchAll(user,first.rows[2].seq,100);expect(rest.rows).toHaveLength(4);expect(rest.more).toBe(false);
  const small=await ports.pull(user,KEY,0,100,2500);expect(small!.rows).toHaveLength(2);expect(small!.more).toBe(true);
  const tiny=await ports.pull(user,KEY,0,100,10);expect(tiny!.rows).toHaveLength(1);
 });
 it('stops taking records once the account is full, but always takes one that shrinks',async()=>{
  const user=await account();await handleMemorySync('memory-sync-setup',profile,user,ports);
  await db.query('update dream_limits set memory_sync_bytes=100');
  try{
   const r=(await send(user,[row('sid-aaaa',1,'aaaa1111','QUFB'.repeat(10)),row('sid-bbbb',1,'aaaa1111','QUFB'.repeat(10)),row('sid-cccc',1,'aaaa1111','QUFB'.repeat(10))])).body as any;
   expect(r).toMatchObject({applied:2,taken:2,full:true,bytes:80,limit:100});
   expect((await send(user,[row('sid-aaaa',2,'aaaa1111','QQ==')])).body).toMatchObject({applied:1,bytes:44});
   expect((await readSyncProfile(user,ports)).body).toMatchObject({bytes:44});
  }finally{await db.query('update dream_limits set memory_sync_bytes=268435456');}
 });
 it('refuses pushes and pulls under a key that is no longer the account\'s, and resets cleanly',async()=>{
  const user=await account();await handleMemorySync('memory-sync-setup',profile,user,ports);await send(user,[row('sid-aaaa',1)]);
  expect((await send(user,[row('sid-bbbb',1)],'y'.repeat(32))).status).toBe(409);
  expect(await handleMemorySync('memory-sync-reset',{},user,ports)).toEqual({status:200,body:{reset:true}});
  expect((await readSyncProfile(user,ports)).body).toMatchObject({profile:null});
  expect((await send(user,[row('sid-bbbb',1)])).status).toBe(409);
  expect((await db.query('select 1 from dream_memory_sync where user_id=$1',[user])).rows).toHaveLength(0);
 });
 it('refuses what is not a sealed record',async()=>{
  const user=await account();await handleMemorySync('memory-sync-setup',profile,user,ports);
  expect((await send(user,[{...row('sid-aaaa',1),payload:'not base64!'}])).status).toBe(400);
  expect((await send(user,[row('sid-aaaa',1),row('sid-aaaa',2)])).status).toBe(400);
  expect((await send(user,[row('x',1)])).status).toBe(400);
  expect((await send(user,[])).status).toBe(400);
 });
 it('lets a signed-in user read only their own ciphertext, and write none of it',async()=>{
  const me=await account(),other=await account();
  for(const u of [me,other]){await handleMemorySync('memory-sync-setup',profile,u,ports);await send(u,[row('sid-'+u.slice(0,8),1)]);}
  const rls=await db.query<{relname:string;relrowsecurity:boolean}>("select relname,relrowsecurity from pg_class where relname in ('dream_memory_sync','dream_memory_sync_keys')");
  expect(rls.rows.every(r=>r.relrowsecurity)).toBe(true);
  await db.exec(`grant usage on schema public to authenticated; grant usage on schema auth to authenticated; grant execute on function auth.uid() to authenticated;`);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[me]);
  await db.exec('set role authenticated');
  try{
   expect((await db.query<{user_id:string}>('select user_id from dream_memory_sync')).rows.map(r=>r.user_id)).toEqual([me]);
   expect((await db.query<{user_id:string}>('select user_id from dream_memory_sync_keys')).rows.map(r=>r.user_id)).toEqual([me]);
   await expect(db.query("insert into dream_memory_sync(user_id,sid,seq,at,device,version,payload,size) values($1,'sid-zzzz',1,1,'aaaa1111',1,'QQ==',4)",[me])).rejects.toThrow();
   await expect(db.query("update dream_memory_sync set payload='QQ=='")).rejects.toThrow();
   await expect(db.query('select dream_memory_sync_pull($1,$2,0,10,1000)',[other,KEY])).rejects.toThrow();
  }finally{await db.exec('reset role');}
  const anon=await db.query("select grantee,privilege_type from information_schema.role_table_grants where table_name in ('dream_memory_sync','dream_memory_sync_keys') and grantee in ('anon','authenticated')");
  expect(anon.rows).toEqual([{grantee:'authenticated',privilege_type:'SELECT'},{grantee:'authenticated',privilege_type:'SELECT'}]);
 });
});
