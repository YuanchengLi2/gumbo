/** The extension's signing key: kept in .secrets (never committed), so the unpacked extension always has the same id
 * (sign-in and tests address it by id). Prints the public key for manifest.json's "key" and the id it gives.
 *   npx tsx apps/extension/scripts/key.ts */
import {generateKeyPairSync,createPublicKey,createHash} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
const file=resolve(import.meta.dirname,'../../../.secrets/gumbo-extension-key.pem');
if(!existsSync(file)){mkdirSync(resolve(file,'..'),{recursive:true});const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});writeFileSync(file,privateKey.export({type:'pkcs8',format:'pem'}));}
const der=createPublicKey(readFileSync(file)).export({type:'spki',format:'der'});
export const extensionId=(publicKey:Buffer)=>[...createHash('sha256').update(publicKey).digest('hex').slice(0,32)].map(c=>String.fromCharCode(97+parseInt(c,16))).join('');
console.log(JSON.stringify({key:der.toString('base64'),id:extensionId(der)},null,1));
