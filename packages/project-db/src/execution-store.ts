import type Database from 'better-sqlite3';
import {BlobStore} from './blob-store';
function immutable(value:any):any{if(value&&typeof value==='object'&&!Object.isFrozen(value)){for(const child of Object.values(value))immutable(child);Object.freeze(value);}return value;}

/** Exchanges are append-only; checkpoints reference them instead of copying history. */
export class ExecutionStore {
 private sessions=new Map<string,{messages:any[];count:number;refs:any[]}>();
 constructor(private db:Database.Database,private blobs:BlobStore){}
 save(key:string,state:any){
  return this.db.transaction(()=>{
   const {messages,...rest}=state;
   if(!Array.isArray(messages))return this.blobs.putJSON(this.blobs.pack(state));
   let session=this.sessions.get(key);
   if(!session||session.messages!==messages){session={messages,count:0,refs:[]};this.sessions.set(key,session);}
   if(messages.length<session.count||session.refs.some((message,index)=>messages[index]!==message))throw new Error('Execution history changed; create a new checkpoint scope.');
   for(let n=session.count;n<messages.length;n++){
    const hash=this.blobs.putJSON(this.blobs.pack(messages[n]));
    const old=this.db.prepare('SELECT hash FROM execution_journal WHERE scope=? AND ordinal=?').get(key,n) as {hash:string}|undefined;
    if(old&&old.hash!==hash)throw new Error('Execution history changed; create a new checkpoint scope.');
    this.db.prepare('INSERT OR IGNORE INTO execution_journal(scope,ordinal,hash) VALUES(?,?,?)').run(key,n,hash);
    session.refs[n]=immutable(messages[n]);
   }
   const hash=this.blobs.putJSON(this.blobs.pack({...rest,$journal:{scope:key,count:messages.length}}));session.count=messages.length;return hash;
  })();
 }
 load(hash:string){const value=this.blobs.unpack(this.blobs.getJSON(hash));if(value.$journal){const {scope,count}=value.$journal;delete value.$journal;const rows=this.db.prepare('SELECT hash FROM execution_journal WHERE scope=? AND ordinal<? ORDER BY ordinal').all(scope,count) as {hash:string}[];if(rows.length!==count)throw new Error('Execution journal is incomplete.');value.messages=rows.map(row=>immutable(this.blobs.unpack(this.blobs.getJSON(row.hash))));this.sessions.set(scope,{messages:value.messages,count,refs:[...value.messages]});}return value;}
 receipt(scope:string,id:string,name:string,result:unknown){const hash=this.blobs.putJSON(this.blobs.pack(result));this.db.prepare('INSERT INTO execution_receipts(scope,call_id,name,hash) VALUES(?,?,?,?) ON CONFLICT(scope,call_id) DO UPDATE SET hash=excluded.hash').run(scope,id,name,hash);}
 receipts(scope:string){return(this.db.prepare('SELECT call_id,name,hash FROM execution_receipts WHERE scope=?').all(scope) as {call_id:string;name:string;hash:string}[]).map(row=>({...row,result:this.blobs.unpack(this.blobs.getJSON(row.hash))}));}
}
