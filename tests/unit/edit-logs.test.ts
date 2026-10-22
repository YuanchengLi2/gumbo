import {describe,it,expect} from 'vitest';
import {mkdtempSync,readdirSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {EditLogs,MAX_LOG_BYTES,KEEP_MS,backoff,type EditLogPorts} from '../../apps/desktop/src/main/edit-logs';

/** Every edit's log, sent by the app on its own (apps/desktop/src/main/edit-logs.ts): queued on disk at once, sent in the
 * background, tried again later when it can't be, after a restart too, and each run only once. */
const folder=()=>mkdtempSync(join(tmpdir(),'gumbo-edit-logs-'));
const log=(turnId:string,run='2026-10-21T10:00:00.000Z',extra:Record<string,unknown>={})=>({version:2,turnId,request:'Make it shorter',outcome:{status:'complete'},timing:{runStartedAt:run},cost:{usd:0.02,credits:2,calls:3},totals:[],...extra});
function fake(statuses:number[]=[],account:string|undefined='u1'){
 const sent:any[]=[],clock={now:1_000_000};
 const ports:EditLogPorts&{account():string|undefined}={account:()=>account,send:async entry=>{sent.push(entry);return statuses.length?statuses.shift()!:200;},appVersion:'0.2.4',platform:'win32 x64',training:()=>false,now:()=>clock.now};
 return{sent,clock,ports,setAccount:(a:string|undefined)=>{account=a;}};
}
const queued=(dir:string)=>readdirSync(dir).filter(n=>/^[0-9a-f]{40}\.json$/.test(n));

describe('edit logs from the app',()=>{
 it('queues a finished run on disk and sends it once in the background',async()=>{
  const dir=folder(),{sent,ports}=fake(),logs=new EditLogs(dir,ports);
  expect(await logs.capture('t1',log('t1'))).toBe(true);await logs.flush();
  expect(sent).toHaveLength(1);expect(sent[0]).toMatchObject({key:'t1@2026-10-21T10:00:00.000Z',turnId:'t1',appVersion:'0.2.4',platform:'win32 x64',training:false,log:{request:'Make it shorter'}});
  // Sent once: the same run again, from this copy or after a restart, is not queued.
  expect(await logs.capture('t1',log('t1'))).toBe(false);expect(await new EditLogs(dir,ports).capture('t1',log('t1'))).toBe(false);
  await logs.flush();expect(sent).toHaveLength(1);expect(queued(dir)).toHaveLength(0);
  // A resumed request is a new run: its longer log goes too.
  expect(await logs.capture('t1',log('t1','2026-10-21T10:05:00.000Z'))).toBe(true);await logs.flush();expect(sent).toHaveLength(2);
 });
 it('does not hold up the run that queued it',async()=>{
  const dir=folder();let release!:()=>void;const gate=new Promise<void>(r=>{release=r;});
  const {ports}=fake();const slow:EditLogPorts={...ports,send:async()=>{await gate;return 200;}},logs=new EditLogs(dir,slow);
  // capture answers as soon as the log is on disk, while the send still waits on the network.
  expect(await logs.capture('t1',log('t1'))).toBe(true);expect(queued(dir)).toHaveLength(1);
  release();await logs.flush();expect(queued(dir)).toHaveLength(0);
 });
 it('keeps a log offline and sends it later, after a restart too',async()=>{
  const dir=folder(),first=fake([0]),logs=new EditLogs(dir,first.ports);
  await logs.capture('t1',log('t1'));await logs.flush();
  expect(first.sent).toHaveLength(1);expect(queued(dir)).toHaveLength(1);
  const waiting=JSON.parse(readFileSync(join(dir,queued(dir)[0]),'utf8'));expect(waiting).toMatchObject({attempts:1,nextAt:first.clock.now+backoff(1)});
  // Not before its wait is over.
  await logs.flush();expect(first.sent).toHaveLength(1);
  // The app restarts later and online: the queued log goes.
  const second=fake();second.clock.now=first.clock.now+backoff(1)+1;await new EditLogs(dir,second.ports).flush();
  expect(second.sent.map(e=>e.turnId)).toEqual(['t1']);expect(queued(dir)).toHaveLength(0);
 });
 it('waits longer after each failure, and stops trying after two weeks',async()=>{
  expect([1,2,3].map(backoff)).toEqual([60_000,120_000,240_000]);expect(backoff(30)).toBe(6*3_600_000);
  const dir=folder(),{sent,clock,ports}=fake([503,503]),logs=new EditLogs(dir,ports);
  await logs.capture('t1',log('t1'));await logs.flush();clock.now+=backoff(1)+1;await logs.flush();
  expect(JSON.parse(readFileSync(join(dir,queued(dir)[0]),'utf8')).attempts).toBe(2);
  clock.now+=KEEP_MS;await logs.flush();expect(sent).toHaveLength(2);expect(queued(dir)).toHaveLength(0);
 });
 it('sends a log only for the account whose edit it was, and nothing signed out',async()=>{
  const dir=folder(),f=fake(),logs=new EditLogs(dir,f.ports);
  f.setAccount(undefined);expect(await logs.capture('t0',log('t0'))).toBe(false);
  f.setAccount('u1');await logs.capture('t1',log('t1'));f.setAccount('u2');await logs.flush();expect(f.sent).toHaveLength(0);
  f.setAccount('u1');await logs.flush();expect(f.sent).toHaveLength(1);
 });
 it('drops a log the gateway refuses for good, and keeps one it will take later',async()=>{
  const dir=folder(),{sent,clock,ports}=fake([413,404,200]),logs=new EditLogs(dir,ports);
  await logs.capture('t1',log('t1'));await logs.flush();expect(queued(dir)).toHaveLength(0);
  // A gateway without the route yet (404) keeps the log for when it has it.
  await logs.capture('t2',log('t2'));await logs.flush();expect(queued(dir)).toHaveLength(1);
  clock.now+=backoff(1)+1;await logs.flush();expect(sent.map(e=>e.turnId)).toEqual(['t1','t2','t2']);expect(queued(dir)).toHaveLength(0);
 });
 it('sends an oversized log as its summary',async()=>{
  const dir=folder(),{sent,ports}=fake(),logs=new EditLogs(dir,ports);
  await logs.capture('t1',log('t1','r',{conversation:[{text:'x'.repeat(MAX_LOG_BYTES)}]}));await logs.flush();
  expect(sent[0].log).toMatchObject({turnId:'t1',request:'Make it shorter',outcome:{status:'complete'},cost:{credits:2}});
  expect(sent[0].log.conversation).toBeUndefined();expect(sent[0].log.tooLarge).toBeGreaterThan(MAX_LOG_BYTES);
 });
});
