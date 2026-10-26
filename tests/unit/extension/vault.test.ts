import {describe,expect,it,vi} from 'vitest';
vi.mock('../../../apps/extension/src/background/auth',()=>({session:async()=>null,token:async()=>null}));
vi.mock('../../../apps/extension/src/shared/config',()=>({endpoints:async()=>({gateway:''})}));
vi.mock('../../../apps/extension/src/shared/gateway',()=>({gatewayGet:async()=>({})}));
const {seal,open}=await import('../../../apps/extension/src/background/vault');

const keys=async()=>({user:'u',dek:await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']),index:await crypto.subtle.generateKey({name:'HMAC',hash:'SHA-256'},false,['sign'])});

describe('sealed memory takes little room',()=>{
 it('compresses long records before sealing and opens them back',async()=>{
  const k=await keys(),page={title:'A long page',text:'The planning meeting moved to room 4B. '.repeat(400)};
  const box=await seal(k,page);
  expect(box.z).toBe(1);
  expect(box.data.byteLength).toBeLessThan(JSON.stringify(page).length/5);
  expect(await open(k,box)).toEqual(page);
 });
 it('leaves short records as they are, and still opens boxes sealed before compression',async()=>{
  const k=await keys(),short={at:1,text:'hi'};
  const box=await seal(k,short);expect(box.z).toBeUndefined();expect(await open(k,box)).toEqual(short);
  // A box from before: plain JSON, sealed, no mark.
  const iv=crypto.getRandomValues(new Uint8Array(12)),old={iv,data:await crypto.subtle.encrypt({name:'AES-GCM',iv},k.dek,new TextEncoder().encode(JSON.stringify({text:'x'.repeat(2000)})))};
  expect(await open<any>(k,old)).toEqual({text:'x'.repeat(2000)});
 });
});
