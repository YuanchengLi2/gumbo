import {documentDelta,applyDocumentDelta} from '../../timeline/src/document-delta';
import type Database from 'better-sqlite3';
import {BlobStore,contentHash} from './blob-store';
import {TimelineSchema,type TimelineDocument} from '@dream/timeline';

const canonical=(value:unknown)=>JSON.stringify(value,(_key,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const documentHash=(value:unknown)=>'c:'+contentHash(canonical(value));
const matches=(value:unknown,hash:string)=>hash.startsWith('c:')?documentHash(value)===hash:contentHash(JSON.stringify(value))===hash;
export class VersionStore {
 private cache=new Map<string,TimelineDocument>();
 constructor(private db:Database.Database,private blobs:BlobStore){}
 read(id:string):TimelineDocument {
  const cached=this.cache.get(id);if(cached)return structuredClone(cached);
  const row=this.db.prepare('SELECT * FROM version_storage WHERE version_id=?').get(id) as {base_id:string|null;depth:number;hash:string;document_hash:string}|undefined;
  let value:TimelineDocument;
  if(row){const payload=this.blobs.getJSON(row.hash);value=row.base_id?TimelineSchema.parse(applyDocumentDelta(this.read(row.base_id),payload)):payload;if(!matches(value,row.document_hash))throw new Error('Timeline revision checksum mismatch.');}
  else{const legacy=this.db.prepare('SELECT snapshot FROM versions WHERE id=?').get(id) as {snapshot:string}|undefined;if(!legacy?.snapshot)throw new Error('Version not found.');value=JSON.parse(legacy.snapshot);}
  this.cache.set(id,structuredClone(value));if(this.cache.size>8)this.cache.delete(this.cache.keys().next().value!);return value;
 }
 write(id:string,value:TimelineDocument,parent:string|null){
  const previous=parent?this.db.prepare('SELECT depth FROM version_storage WHERE version_id=?').get(parent) as {depth:number}|undefined:undefined;
  const useDelta=!!parent&&!!previous&&previous.depth<49;
  const payload=useDelta?documentDelta(this.read(parent!),value):value;
  const hash=this.blobs.putJSON(payload),expectedHash=documentHash(value);
  this.db.prepare('INSERT INTO version_storage(version_id,base_id,depth,hash,document_hash) VALUES(?,?,?,?,?)').run(id,useDelta?parent:null,useDelta?previous!.depth+1:0,hash,expectedHash);
  // Verify from stored bytes before legacy snapshots may be discarded.
  this.cache.delete(id);if(!matches(this.read(id),expectedHash))throw new Error('Timeline migration verification failed.');
 }
 migrateLegacy(){for(;;){const rows=this.db.prepare("SELECT id,parent_id,snapshot FROM versions WHERE snapshot<>'' AND id NOT IN (SELECT version_id FROM version_storage) ORDER BY rowid LIMIT 50").all() as {id:string;parent_id:string|null;snapshot:string}[];if(!rows.length)break;this.db.transaction(()=>{for(const row of rows){this.write(row.id,JSON.parse(row.snapshot),row.parent_id);this.db.prepare("UPDATE versions SET snapshot='' WHERE id=?").run(row.id);}})();}}
}
