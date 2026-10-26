/** End-to-end encryption for memory sync (background/sync.ts): what leaves the computer is sealed with a key made here
 * from a passphrase only the user knows, so the synced copy on Gumbo's server is ciphertext it can't read.
 * - The passphrase becomes a 256-bit key with PBKDF2 (SHA-256, 600,000 rounds, a random salt kept with the synced
 *   copy). The passphrase and the key never leave the computer.
 * - From that key, HKDF makes three: one seals records (AES-256-GCM), one names them (an HMAC of what identifies a
 *   record, so the same page read on two computers is one record and the server can't tell what it is), and one makes a
 *   check value, so another computer can tell a wrong passphrase at once.
 * - Each record's id and stamp (time, computer, version) are sealed with it as additional data: the server can't move a
 *   record's ciphertext to another id, change its stamp, or make a deletion up. */
export type Kdf={name:'PBKDF2';hash:'SHA-256';iterations:number};
/** What the server keeps about the key: its id, the salt, how it was made, and the check value. None of it opens anything. */
export type SyncProfile={keyId:string;salt:string;kdf:Kdf;verifier:string};
export type SyncKeys={keyId:string;data:CryptoKey;index:CryptoKey};
/** A record's version: when it was written, on which computer, and how many times. */
export type Stamp={at:number;device:string;version:number};
/** A record as the server holds it: its id, its stamp, and the sealed body; seq is the server's order of arrival. */
export type SyncRow=Stamp&{sid:string;payload:string;seq?:number};
/** What a sealed record holds: its store and its value; no value is a deletion. */
export type Body={s:string;v?:unknown};

export const KDF:Kdf={name:'PBKDF2',hash:'SHA-256',iterations:600_000};
export const MIN_PASSPHRASE=10;
const enc=new TextEncoder(),dec=new TextDecoder();
export const b64=(bytes:ArrayBuffer|Uint8Array)=>{let s='';const a=new Uint8Array(bytes);for(let i=0;i<a.length;i+=0x8000)s+=String.fromCharCode(...a.subarray(i,i+0x8000));return btoa(s);};
export const unb64=(text:string)=>Uint8Array.from(atob(text),c=>c.charCodeAt(0)) as Uint8Array<ArrayBuffer>;
const b64url=(bytes:ArrayBuffer|Uint8Array)=>b64(bytes).replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
const hex=(bytes:Uint8Array)=>[...bytes].map(b=>b.toString(16).padStart(2,'0')).join('');
/** The same passphrase typed on another keyboard (composed accents, full-width characters, a stray space) is the same key. */
export const normalize=(passphrase:string)=>passphrase.normalize('NFKC').trim();
/** A random id for a computer or a key. */
export const randomId=(bytes=16)=>hex(crypto.getRandomValues(new Uint8Array(bytes)));

/** A passphrase made for the user: 20 random letters and digits in groups of five (100 bits). */
export function suggestPassphrase(){
 // 32 symbols, without i, l and o, so each is five bits and none is mistaken for another.
 const letters='abcdefghjkmnpqrstuvwxyz023456789',out:string[]=[];
 for(const byte of crypto.getRandomValues(new Uint8Array(20)))out.push(letters[byte%32]);
 return [0,5,10,15].map(i=>out.slice(i,i+5).join('')).join('-');
}

export async function deriveMaster(passphrase:string,salt:Uint8Array<ArrayBuffer>,kdf:Kdf):Promise<Uint8Array<ArrayBuffer>>{
 const base=await crypto.subtle.importKey('raw',enc.encode(normalize(passphrase)),'PBKDF2',false,['deriveBits']);
 return new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',hash:kdf.hash,salt,iterations:kdf.iterations},base,256));
}
async function hkdf(master:Uint8Array<ArrayBuffer>,info:string,usage:AesKeyAlgorithm|HmacKeyGenParams,uses:KeyUsage[]){
 const base=await crypto.subtle.importKey('raw',master,'HKDF',false,['deriveKey']);
 return crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:enc.encode('gumbo-sync'),info:enc.encode(info)},base,usage,false,uses);
}
export async function syncKeys(master:Uint8Array<ArrayBuffer>,keyId:string):Promise<SyncKeys>{
 return{keyId,data:await hkdf(master,'data v1',{name:'AES-GCM',length:256},['encrypt','decrypt']),index:await hkdf(master,'index v1',{name:'HMAC',hash:'SHA-256',length:256},['sign'])};
}
async function verifierOf(master:Uint8Array<ArrayBuffer>,keyId:string){
 const key=await hkdf(master,'check v1',{name:'HMAC',hash:'SHA-256',length:256},['sign']);
 return b64(await crypto.subtle.sign('HMAC',key,enc.encode('gumbo-sync-check:'+keyId)));
}
/** A new key from a passphrase, and what the server keeps about it. */
export async function createProfile(passphrase:string,kdf:Kdf=KDF):Promise<{profile:SyncProfile;master:Uint8Array<ArrayBuffer>}>{
 if(normalize(passphrase).length<MIN_PASSPHRASE)throw new Error(`Use at least ${MIN_PASSPHRASE} characters.`);
 const salt=crypto.getRandomValues(new Uint8Array(16)),keyId=randomId(),master=await deriveMaster(passphrase,salt,kdf);
 return{profile:{keyId,salt:b64(salt),kdf,verifier:await verifierOf(master,keyId)},master};
}
/** The key a passphrase makes for this profile, or null when it is not the passphrase that made it. */
export async function unlockProfile(passphrase:string,profile:SyncProfile):Promise<Uint8Array<ArrayBuffer>|null>{
 const master=await deriveMaster(passphrase,unb64(profile.salt),profile.kdf);
 return await verifierOf(master,profile.keyId)===profile.verifier?master:null;
}

/** A record's id in the synced copy, from what identifies it (a page's address, a meeting's id), under the user's key. */
export async function sidOf(keys:SyncKeys,store:string,natural:string){
 return b64url((await crypto.subtle.sign('HMAC',keys.index,enc.encode(store+'\n'+natural))).slice(0,16));
}
const additional=(sid:string,stamp:Stamp)=>enc.encode(`gumbo-sync v1\n${sid}\n${stamp.at}\n${stamp.device}\n${stamp.version}`);
const COMPRESS_FROM=512;
async function squeeze(bytes:Uint8Array,how:'compress'|'decompress'){
 const stream=new Blob([bytes as BlobPart]).stream().pipeThrough(how==='compress'?new CompressionStream('deflate-raw'):new DecompressionStream('deflate-raw'));
 return new Uint8Array(await new Response(stream).arrayBuffer());
}
/** Seals a record for the server: one version byte, a compression flag, the 12-byte IV, then the ciphertext. */
export async function sealRow(keys:SyncKeys,sid:string,stamp:Stamp,body:Body):Promise<SyncRow>{
 const plain=enc.encode(JSON.stringify(body)),z=plain.length>=COMPRESS_FROM,iv=crypto.getRandomValues(new Uint8Array(12));
 const data=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:additional(sid,stamp)},keys.data,z?await squeeze(plain,'compress'):plain));
 const out=new Uint8Array(14+data.length);out[0]=1;out[1]=z?1:0;out.set(iv,2);out.set(data,14);
 return{sid,at:stamp.at,device:stamp.device,version:stamp.version,payload:b64(out)};
}
/** Opens a record from the server; throws when it was sealed with another key or changed on the way. */
export async function openRow(keys:SyncKeys,row:SyncRow):Promise<Body>{
 const bytes=unb64(row.payload);if(bytes[0]!==1)throw new Error('Unknown record format');
 const plain=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.slice(2,14),additionalData:additional(row.sid,row)},keys.data,bytes.slice(14)));
 const body=JSON.parse(dec.decode(bytes[1]?await squeeze(plain,'decompress'):plain));
 if(!body||typeof body.s!=='string')throw new Error('Not a memory record');
 return body;
}
