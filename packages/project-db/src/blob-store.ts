import {createHash} from 'node:crypto';
import {deflateSync,inflateSync} from 'node:zlib';
import type Database from 'better-sqlite3';

export const contentHash=(bytes:string|Buffer)=>createHash('sha256').update(bytes).digest('hex');
/** Project-owned content, included automatically in SQLite backup/collection. */
export class BlobStore {
 constructor(private db:Database.Database){}
 put(text:string){const hash=contentHash(text);if(!this.db.prepare('SELECT 1 FROM content_blobs WHERE hash=?').get(hash)){const bytes=Buffer.from(text);this.db.prepare('INSERT OR IGNORE INTO content_blobs(hash,codec,bytes,raw_size) VALUES(?,?,?,?)').run(hash,'deflate',deflateSync(bytes),bytes.length);}return hash;}
 get(hash:string):string {const row=this.db.prepare('SELECT codec,bytes FROM content_blobs WHERE hash=?').get(hash) as {codec:string;bytes:Buffer}|undefined;if(!row)throw new Error('Saved content is missing: '+hash);const text=inflateSync(row.bytes).toString('utf8');if(contentHash(text)!==hash)throw new Error('Saved content checksum mismatch: '+hash);return text;}
 putJSON(value:unknown){return this.put(JSON.stringify(value));}
 getJSON<T=any>(hash:string):T{return JSON.parse(this.get(hash));}
 /** Large strings are shared even when their enclosing receipt changes. */
 pack(value:any):any {if(typeof value==='string'&&value.length>4096)return{$dreamText:this.put(value)};if(Array.isArray(value))return value.map(v=>this.pack(v));if(value&&typeof value==='object'){const entries=Object.entries(value).map(([k,v])=>[k,this.pack(v)]);return Object.hasOwn(value,'$dreamText')||Object.hasOwn(value,'$dreamObject')?{$dreamObject:entries}:Object.fromEntries(entries);}return value;}
 unpack(value:any):any {if(value&&typeof value==='object'&&Object.keys(value).length===1&&Array.isArray(value.$dreamObject))return Object.fromEntries(value.$dreamObject.map(([k,v]:[string,any])=>[k,this.unpack(v)]));if(value&&typeof value==='object'&&!Array.isArray(value)&&Object.keys(value).length===1&&typeof value.$dreamText==='string')return this.get(value.$dreamText);if(Array.isArray(value))return value.map(v=>this.unpack(v));if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).map(([k,v])=>[k,this.unpack(v)]));return value;}
}
