import {it,expect} from 'vitest';
import {connectionClient} from '../../apps/project-service/src/connection-client';

/** The account connection check (connection-client.ts) asks again when the main process is slow to answer, instead of
 * ending the request at the first timeout; a real error is not retried. */
const connection={url:'https://gateway.test',token:'t',anonKey:'k'};

it('asks again after a timeout, with more time, and returns the late answer',async()=>{
 const asked:string[]=[];let client:ReturnType<typeof connectionClient>;
 // The main process answers only the second check.
 client=connectionClient({postMessage:(m:any)=>{asked.push(m.connection.id);if(asked.length===2)setTimeout(()=>client.receive({id:m.connection.id,result:connection}),30);}},20,3);
 await expect(client.request()).resolves.toMatchObject({token:'t'});expect(asked).toHaveLength(2);
});

it('gives up after its attempts, and does not retry a real error',async()=>{
 let asked=0;const silent=connectionClient({postMessage:()=>{asked++;}},10,3);
 await expect(silent.request()).rejects.toThrow(/timed out/);expect(asked).toBe(3);
 let tries=0;let client:ReturnType<typeof connectionClient>;
 client=connectionClient({postMessage:(m:any)=>{tries++;setTimeout(()=>client.receive({id:m.connection.id,error:'Sign in to use Gumbo AI.'}),1);}},50,3);
 await expect(client.request()).rejects.toThrow('Sign in to use Gumbo AI.');expect(tries).toBe(1);
});
