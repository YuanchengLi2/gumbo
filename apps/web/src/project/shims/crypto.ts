import {Buffer} from 'buffer';
import {sha256,sha512} from '@noble/hashes/sha2';
import {sha1} from '@noble/hashes/legacy';
/** node:crypto in the browser: synchronous hashes (the project service hashes as it reads), random ids and bytes. */
const algorithms:Record<string,typeof sha256>={sha256,sha512,sha1};
export function createHash(name:string){
 const algorithm=algorithms[name.toLowerCase()];if(!algorithm)throw new Error(`Hash ${name} is not available in the browser.`);
 const hash=algorithm.create();
 const api={update(data:string|Uint8Array,encoding?:string){hash.update(typeof data==='string'?Buffer.from(data,(encoding??'utf8') as BufferEncoding):data);return api;},
  digest(encoding?:string):any{const out=Buffer.from(hash.digest());return encoding==='base64url'?out.toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,''):encoding?out.toString(encoding as BufferEncoding):out;}};
 return api;
}
export const randomUUID=()=>crypto.randomUUID();
export const randomBytes=(size:number)=>Buffer.from(crypto.getRandomValues(new Uint8Array(size)));
export const randomInt=(min:number,max?:number)=>{if(max===undefined){max=min;min=0;}return min+Math.floor(Math.random()*(max-min));};
export const webcrypto=globalThis.crypto;
export default {createHash,randomUUID,randomBytes,randomInt,webcrypto};
