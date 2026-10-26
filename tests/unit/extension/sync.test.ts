import {describe,expect,it} from 'vitest';
import {createProfile,unlockProfile,syncKeys,sealRow,openRow,sidOf,suggestPassphrase,KDF,type SyncKeys,type Stamp,type Body,type Kdf} from '../../../apps/extension/src/shared/sync-crypto';
import {pull,push,newer,nextStamp,KeyChanged,type Replica,type Remote,type Outgoing} from '../../../apps/extension/src/shared/sync-engine';
import {handleMemorySync} from '../../../supabase/functions/dream-gateway/memory-sync';
import {memorySyncServer} from '../../../apps/extension/test/sync-server';

/** Memory sync: the key made from the user's passphrase, records sealed under it, and two computers merging through the
 * gateway's own handler (with the synced copy in memory; the same rules in Postgres are in
 * tests/integration/memory-sync.test.ts). */
const quick:Kdf={...KDF,iterations:100_000};
const text=(payload:string)=>Buffer.from(payload,'base64').toString('latin1');

describe('the sync key',()=>{
 it('is made from the passphrase the same way on every computer, and a wrong passphrase is told at once',async()=>{
  const {profile,master}=await createProfile('correct horse battery staple');
  expect(profile.kdf).toEqual({name:'PBKDF2',hash:'SHA-256',iterations:600_000});
  expect(Object.keys(profile).sort()).toEqual(['kdf','keyId','salt','verifier']);
  expect(await unlockProfile('correct horse battery staple',profile)).toEqual(master);
  // Typed with stray spaces or composed differently, it is the same passphrase.
  expect(await unlockProfile('  correct horse battery staple ',profile)).toEqual(master);
  expect(await unlockProfile('correct horse battery stable',profile)).toBeNull();
  // A second account with the same passphrase gets another key (its own salt).
  expect((await createProfile('correct horse battery staple',quick)).master).not.toEqual(master);
 });
 it('refuses a short passphrase, and suggests long random ones',async()=>{
  await expect(createProfile('short')).rejects.toThrow(/at least 10/);
  const a=suggestPassphrase(),b=suggestPassphrase();
  expect(a).toMatch(/^[a-z0-9]{5}-[a-z0-9]{5}-[a-z0-9]{5}-[a-z0-9]{5}$/);expect(a).not.toBe(b);expect(a).not.toMatch(/[ilo]/);
 });
 it('seals records so only the same key opens them, unchanged',async()=>{
  const {profile,master}=await createProfile('a long passphrase here',quick),keys=await syncKeys(master,profile.keyId);
  const stamp:Stamp={at:1_790_000_000_000,device:'aa11',version:3};
  const page={s:'pages',v:{url:'https://example.com/plans',title:'Launch plans',text:'The launch moves to March. '.repeat(200)}};
  const row=await sealRow(keys,'sid-0001',stamp,page);
  expect(await openRow(keys,row)).toEqual(page);
  // Long records are compressed first; nothing readable is in what the server gets.
  expect(row.payload.length).toBeLessThan(JSON.stringify(page).length/4);
  for(const secret of ['example.com','Launch plans','March','pages'])expect(text(row.payload)).not.toContain(secret);
  const short=await sealRow(keys,'sid-0002',stamp,{s:'notes',v:{text:'Call Dana about the lease',at:5}});
  expect(text(short.payload)).not.toContain('Dana');expect(await openRow(keys,short)).toEqual({s:'notes',v:{text:'Call Dana about the lease',at:5}});
  // Another passphrase's key can't open it.
  const other=await createProfile('another passphrase entirely',quick),otherKeys=await syncKeys(other.master,other.profile.keyId);
  await expect(openRow(otherKeys,row)).rejects.toThrow();
  // The server can't move it to another record, change its stamp or alter a byte.
  await expect(openRow(keys,{...row,sid:'sid-0002'})).rejects.toThrow();
  await expect(openRow(keys,{...row,at:row.at+1})).rejects.toThrow();
  await expect(openRow(keys,{...row,device:'bb22'})).rejects.toThrow();
  const bytes=Buffer.from(row.payload,'base64');bytes[20]^=1;
  await expect(openRow(keys,{...row,payload:bytes.toString('base64')})).rejects.toThrow();
 });
 it('names a record the same on every computer with the key, and differently under another key',async()=>{
  const {profile,master}=await createProfile('a long passphrase here',quick),keys=await syncKeys(master,profile.keyId),again=await syncKeys(master,profile.keyId);
  const other=await createProfile('another passphrase entirely',quick),otherKeys=await syncKeys(other.master,other.profile.keyId);
  const sid=await sidOf(keys,'pages','https://example.com/plans');
  expect(sid).toMatch(/^[A-Za-z0-9_-]{22}$/);
  expect(await sidOf(again,'pages','https://example.com/plans')).toBe(sid);
  expect(await sidOf(keys,'pages','https://example.com/other')).not.toBe(sid);
  expect(await sidOf(keys,'notes','https://example.com/plans')).not.toBe(sid);
  expect(await sidOf(otherKeys,'pages','https://example.com/plans')).not.toBe(sid);
 });
});

describe('which version wins',()=>{
 it('is the later write; at the same millisecond the higher computer; then the higher version',()=>{
  expect(newer({at:2,device:'a',version:1},{at:1,device:'b',version:9})).toBe(true);
  expect(newer({at:1,device:'b',version:1},{at:1,device:'a',version:9})).toBe(true);
  expect(newer({at:1,device:'a',version:2},{at:1,device:'a',version:1})).toBe(true);
  expect(newer({at:1,device:'a',version:1},{at:1,device:'a',version:1})).toBe(false);
 });
 it('stamps an edit after the version it replaces, even when that came from a clock running ahead',()=>{
  expect(nextStamp(undefined,'a',100)).toEqual({at:100,device:'a',version:1});
  expect(nextStamp({at:5_000,device:'b',version:4},'a',100)).toEqual({at:5_001,device:'a',version:5});
 });
});

/** A computer's memory, as the engine sees it: records by what identifies them, each with its change. */
class Computer implements Replica{
 records=new Map<string,any>();changes=new Map<string,{store:string;natural:string;stamp:Stamp;deleted:boolean;dirty:boolean;sid?:string}>();seq=0;
 constructor(public device:string,public clock:()=>number=()=>Date.now()){}
 write(store:string,natural:string,value:any){const key=store+'\n'+natural,prev=this.changes.get(key);this.records.set(key,value);this.changes.set(key,{store,natural,stamp:nextStamp(prev?.stamp,this.device,this.clock()),deleted:false,dirty:true,sid:prev?.sid});}
 remove(store:string,natural:string){const key=store+'\n'+natural,prev=this.changes.get(key);this.records.delete(key);this.changes.set(key,{store,natural,stamp:nextStamp(prev?.stamp,this.device,this.clock()),deleted:true,dirty:true,sid:prev?.sid});}
 get(store:string,natural:string){return this.records.get(store+'\n'+natural);}
 async cursor(){return this.seq;}
 async setCursor(seq:number){this.seq=seq;}
 async prepare(keys:SyncKeys){for(const c of this.changes.values())c.sid??=await sidOf(keys,c.store,c.natural);}
 async outgoing(limit:number):Promise<Outgoing[]>{
  return [...this.changes.values()].filter(c=>c.dirty).slice(0,limit).map(c=>({sid:c.sid!,stamp:c.stamp,body:{s:c.store,v:c.deleted?undefined:{id:c.natural,value:this.get(c.store,c.natural)}}}));
 }
 async sent(items:Outgoing[]){for(const item of items)for(const c of this.changes.values())if(c.sid===item.sid&&!newer(c.stamp,item.stamp))c.dirty=false;}
 async apply(sid:string,stamp:Stamp,body:Body){
  const v=body.v as {id:string;value:any}|undefined;
  const change=[...this.changes.values()].find(c=>c.sid===sid);
  if(change&&!newer(stamp,change.stamp))return false;
  const natural=v?.id??change?.natural;if(natural===undefined)return false;
  const key=body.s+'\n'+natural;
  if(v)this.records.set(key,v.value);else this.records.delete(key);
  this.changes.set(key,{store:body.s,natural,stamp,deleted:!v,dirty:false,sid});return true;
 }
}
async function account(limitBytes?:number){
 const server=memorySyncServer(limitBytes),{profile,master}=await createProfile('the same passphrase on both',quick);
 expect((await handleMemorySync('memory-sync-setup',profile,'u',server.ports)).status).toBe(200);
 const keys=await syncKeys(master,profile.keyId);
 const remote=(keyId=profile.keyId):Remote=>({
  pull:async since=>{const r=await handleMemorySync('memory-sync-pull',{keyId,since,limit:2},'u',server.ports);if(r.status===409)throw new KeyChanged();return r.body as any;},
  push:async rows=>{const r=await handleMemorySync('memory-sync-push',{keyId,rows},'u',server.ports);if(r.status===409)throw new KeyChanged();if(r.status!==200)throw new Error(JSON.stringify(r.body));return r.body as any;},
 });
 const sync=async(c:Computer)=>{await pull(c,remote(),keys);await push(c,remote(),keys,{batch:3});};
 return{server,keys,remote,sync,held:()=>[...server.accounts.get('u')!.rows.values()]};
}

describe('two computers',()=>{
 it('bring each other what they remember, and the server holds only ciphertext',async()=>{
  const {sync,held}=await account(),a=new Computer('aaaa1111'),b=new Computer('bbbb2222');
  a.write('notes','n1',{text:'Dana prefers mornings for calls'});
  a.write('pages','https://example.com/lease',{title:'Lease terms',text:'Rent is due on the first.'});
  for(let i=0;i<5;i++)a.write('writing','w'+i,{text:'Draft number '+i});
  b.write('notes','n2',{text:'Pick up the keys on Friday'});
  await sync(a);await sync(b);await sync(a);
  for(const c of [a,b]){
   expect(c.get('notes','n1')).toEqual({text:'Dana prefers mornings for calls'});
   expect(c.get('notes','n2')).toEqual({text:'Pick up the keys on Friday'});
   expect(c.get('pages','https://example.com/lease')?.title).toBe('Lease terms');
   expect(c.get('writing','w4')).toEqual({text:'Draft number 4'});
  }
  expect(held()).toHaveLength(8);
  for(const row of held()){expect(Object.keys(row).sort()).toEqual(['at','device','payload','seq','sid','size','version']);for(const secret of ['Dana','example.com','Lease','keys','Draft','notes'])expect(text(row.payload)).not.toContain(secret);}
  // Nothing left to send, and a pull with nothing new changes nothing.
  expect(await a.outgoing(10)).toEqual([]);expect(await b.outgoing(10)).toEqual([]);
 });
 it('keep the later edit of a record on both, whichever pushes first',async()=>{
  let now=1000;const {sync}=await account(),a=new Computer('aaaa1111',()=>now),b=new Computer('bbbb2222',()=>now);
  a.write('pages','p',{title:'v1'});await sync(a);await sync(b);
  now=2000;b.write('pages','p',{title:'from b, later'});
  now=1500;a.write('pages','p',{title:'from a, earlier'});
  // b's later edit is pushed after a's earlier one, and a's after b's: either way both end on b's.
  await sync(a);await sync(b);await sync(a);
  expect(a.get('pages','p')).toEqual({title:'from b, later'});expect(b.get('pages','p')).toEqual({title:'from b, later'});
  now=3000;a.write('pages','p',{title:'from a, latest'});await sync(b);await sync(a);await sync(b);
  expect(b.get('pages','p')).toEqual({title:'from a, latest'});
 });
 it('let an edit made after seeing a change win, even when the other computer\'s clock runs ahead',async()=>{
  let now=1_000_000;const {sync}=await account(),ahead=new Computer('aaaa1111',()=>now+3_600_000),b=new Computer('bbbb2222',()=>now);
  ahead.write('notes','n',{text:'from the computer an hour ahead'});await sync(ahead);await sync(b);
  now+=60_000;b.write('notes','n',{text:'edited a minute later'});await sync(b);await sync(ahead);
  expect(ahead.get('notes','n')).toEqual({text:'edited a minute later'});
 });
 it('pick the same version when both write in the same millisecond',async()=>{
  const {sync}=await account(),a=new Computer('aaaa1111',()=>5000),b=new Computer('bbbb2222',()=>5000);
  a.write('notes','n',{text:'a'});b.write('notes','n',{text:'b'});
  await sync(a);await sync(b);await sync(a);
  expect(a.get('notes','n')).toEqual({text:'b'});expect(b.get('notes','n')).toEqual({text:'b'});
 });
 it('carry a deletion to the other computer, and let a later edit bring the record back',async()=>{
  let now=1000;const {sync,held}=await account(),a=new Computer('aaaa1111',()=>now),b=new Computer('bbbb2222',()=>now);
  a.write('pages','p',{title:'Lease'});a.write('notes','n',{text:'keep'});await sync(a);await sync(b);
  now=2000;b.remove('pages','p');now=1500;a.write('pages','p',{title:'Lease, edited before the deletion'});
  await sync(a);await sync(b);await sync(a);
  expect(a.get('pages','p')).toBeUndefined();expect(b.get('pages','p')).toBeUndefined();expect(a.get('notes','n')).toEqual({text:'keep'});
  // The tombstone is sealed like everything else: the server can't tell it from a record.
  expect(held()).toHaveLength(2);
  now=3000;a.write('pages','p',{title:'Lease, read again'});await sync(a);await sync(b);
  expect(b.get('pages','p')).toEqual({title:'Lease, read again'});
 });
 it('send only what is newer: a computer that pushed an older version takes the newer one on its next pull',async()=>{
  let now=1000;const {keys,remote}=await account(),a=new Computer('aaaa1111',()=>now),b=new Computer('bbbb2222',()=>now);
  now=2000;a.write('notes','n',{text:'newer'});await push(a,remote(),keys);
  now=1000;b.write('notes','n',{text:'older'});
  expect(await push(b,remote(),keys)).toEqual({sent:1,full:false,tooLarge:0});
  expect(await b.outgoing(10)).toEqual([]);
  await pull(b,remote(),keys);expect(b.get('notes','n')).toEqual({text:'newer'});
 });
 it('stop, rather than mix keys, once another computer set a new passphrase',async()=>{
  const {server,keys,remote}=await account(),a=new Computer('aaaa1111');a.write('notes','n',{text:'x'});
  await handleMemorySync('memory-sync-reset',{},'u',server.ports);
  const fresh=await createProfile('a brand new passphrase',quick);await handleMemorySync('memory-sync-setup',fresh.profile,'u',server.ports);
  await expect(push(a,remote(),keys)).rejects.toBeInstanceOf(KeyChanged);
  await expect(pull(a,remote(),keys)).rejects.toBeInstanceOf(KeyChanged);
  expect(server.accounts.get('u')!.rows.size).toBe(0);
 });
 it('skip records they can\'t open',async()=>{
  const {keys,remote,server}=await account(),a=new Computer('aaaa1111'),b=new Computer('bbbb2222');
  a.write('notes','n',{text:'readable'});await push(a,remote(),keys);
  const row=[...server.accounts.get('u')!.rows.values()][0],bytes=Buffer.from(row.payload,'base64');bytes[30]^=1;row.payload=bytes.toString('base64');
  a.write('notes','m',{text:'also readable'});await push(a,remote(),keys);
  expect(await pull(b,remote(),keys)).toEqual({applied:1,unreadable:1});expect(b.get('notes','m')).toEqual({text:'also readable'});
 });
 it('send what fits when the synced copy is full, and keep the rest for later',async()=>{
  const {keys,remote,server}=await account(1500),a=new Computer('aaaa1111');
  for(let i=0;i<10;i++)a.write('notes','n'+i,{text:`note ${i} `+'x'.repeat(200)});
  const result=await push(a,remote(),keys,{batch:4});
  expect(result.full).toBe(true);expect(result.sent).toBeGreaterThan(0);expect(result.sent).toBeLessThan(10);
  expect(server.accounts.get('u')!.profile.bytes).toBeLessThanOrEqual(1500);
  expect((await a.outgoing(20)).length).toBe(10-result.sent);
 });
});
