import {it,expect} from 'vitest';
import {connectionClient} from '../../apps/project-service/src/connection-client';

it('requests fresh main-process credentials, validates replies and cancels without accepting a late token',async()=>{
 const requests:any[]=[];const client=connectionClient({postMessage:value=>requests.push(value)});
 const first=client.request();client.receive({id:requests[0].connection.id,result:{url:'https://example.supabase.co',token:'first'}});expect((await first).token).toBe('first');
 const second=client.request();expect(requests[1].connection.id).not.toBe(requests[0].connection.id);client.receive({id:requests[1].connection.id,result:{url:'https://example.supabase.co',token:'renewed'}});expect((await second).token).toBe('renewed');
 const controller=new AbortController(),canceled=client.request(controller.signal);controller.abort();await expect(canceled).rejects.toMatchObject({name:'AbortError'});client.receive({id:requests[2].connection.id,result:{url:'https://example.supabase.co',token:'late'}});
 const invalid=client.request();client.receive({id:requests[3].connection.id,result:{url:'not-a-url',token:4}});await expect(invalid).rejects.toThrow();client.close();
});
