import {Buffer} from 'buffer';
import sqlite3InitModule from '@sqlite.org/sqlite-wasm';
import {writeFileSync} from '../fs/sync-fs';

/** better-sqlite3 in the browser: the official SQLite build (WebAssembly) storing databases in this browser's private
 * storage through its synchronous OPFS pool, behind the calls project-db makes (prepare/run/get/all/iterate,
 * transaction, pragma, exec, backup, close). The pool belongs to one worker at a time, which also keeps a project to one
 * tab. sqlite-vec is not loaded: its one function project-db uses, vec_distance_cosine, is registered here instead.
 * initSqlite must finish before a database opens. */
type Pool={OpfsSAHPoolDb:new(name:string)=>any;getFileNames():string[];getCapacity():number;getFileCount():number;addCapacity(n:number):Promise<number>;exportFile(name:string):Uint8Array;importDb(name:string,bytes:Uint8Array):Promise<number>;unlink(name:string):boolean};
let pool:Pool,capi:any;
export async function initSqlite(){
 const sqlite3=await (sqlite3InitModule as any)({print:()=>{},printErr:(...a:unknown[])=>console.warn('[sqlite]',...a)});capi=sqlite3.capi;
 pool=await sqlite3.installOpfsSAHPoolVfs({name:'gumbo-opfs',directory:'/.gumbo-sqlite',initialCapacity:24});
 if(capi.sqlite3_compileoption_used('ENABLE_FTS5')!==1)console.warn('[sqlite] this SQLite build has no FTS5: footage search will fail.');
 await keepRoom();
}
/** Each database takes a slot, with another for its journal; the pool grows ahead of need, since opening is synchronous. */
async function keepRoom(){if(pool.getCapacity()-pool.getFileCount()<8)await pool.addCapacity(16);}
export const databaseFiles=()=>pool.getFileNames();
/** Removes the databases (and their journals) kept under a folder, whose own files are deleted separately. */
export function removeDatabases(prefix:string){for(const name of pool.getFileNames())if(name.startsWith(prefix))pool.unlink(name);}

const asBuffer=(value:unknown)=>value instanceof Uint8Array?Buffer.from(value.buffer,value.byteOffset,value.byteLength):value;
function row(stmt:any){const out:Record<string,unknown>={};for(let i=0;i<stmt.columnCount;i++)out[stmt.getColumnName(i)]=asBuffer(stmt.get(i));return out;}
const plainObject=(v:unknown)=>!!v&&typeof v==='object'&&!(v instanceof Uint8Array)&&!ArrayBuffer.isView(v)&&!Array.isArray(v);

class Statement{
 private pluckFirst=false;
 constructor(private db:Database,readonly source:string,private stmt:any){}
 get reader(){return this.stmt.columnCount>0;}
 pluck(on=true){this.pluckFirst=on;return this;}
 private bind(args:unknown[]){
  this.stmt.reset(true);if(!args.length||this.stmt.parameterCount===0)return;
  // Named parameters (an object, as better-sqlite3 takes them) match @name, :name or $name in the SQL.
  if(args.length===1&&plainObject(args[0])){const values=args[0] as Record<string,unknown>,bound:Record<string,unknown>={};for(let i=1;i<=this.stmt.parameterCount;i++){const name=capi.sqlite3_bind_parameter_name(this.stmt.pointer,i) as string|null;if(name)bound[name]=normalize(values[name.slice(1)]);}this.stmt.bind(bound);return;}
  const flat=args.length===1&&Array.isArray(args[0])?args[0]:args;this.stmt.bind(flat.map(normalize));
 }
 run(...args:unknown[]){this.bind(args);try{this.stmt.step();}finally{this.stmt.reset();}return{changes:capi.sqlite3_changes(this.db.handle.pointer) as number,lastInsertRowid:Number(capi.sqlite3_last_insert_rowid(this.db.handle.pointer))};}
 get(...args:unknown[]){this.bind(args);try{return this.stmt.step()?(this.pluckFirst?asBuffer(this.stmt.get(0)):row(this.stmt)):undefined;}finally{this.stmt.reset();}}
 all(...args:unknown[]){this.bind(args);const out:unknown[]=[];try{while(this.stmt.step())out.push(this.pluckFirst?asBuffer(this.stmt.get(0)):row(this.stmt));}finally{this.stmt.reset();}return out;}
 busy=false;
 *iterate(...args:unknown[]){this.bind(args);this.busy=true;try{while(this.stmt.step())yield this.pluckFirst?asBuffer(this.stmt.get(0)):row(this.stmt);}finally{this.busy=false;this.stmt.reset();}}
 finalize(){this.stmt.finalize();}
}
// SQLite stores booleans as integers and has no undefined; better-sqlite3's callers pass both.
const normalize=(v:unknown)=>v===undefined?null:typeof v==='boolean'?(v?1:0):v;

export default class Database{
 handle:any;readonly name:string;readonly readonly:boolean;open=true;private statements=new Map<string,Statement>();private depth=0;
 constructor(filename:string,options:{readonly?:boolean;fileMustExist?:boolean}={}){
  this.name=filename;this.readonly=!!options.readonly;
  if((options.readonly||options.fileMustExist)&&!pool.getFileNames().includes(filename))throw Object.assign(new Error(`unable to open database file: ${filename}`),{code:'SQLITE_CANTOPEN'});
  this.handle=new pool.OpfsSAHPoolDb(filename);void keepRoom();
  this.handle.createFunction({name:'vec_distance_cosine',deterministic:true,xFunc:(_ctx:unknown,a:Uint8Array,b:Uint8Array)=>{
   const x=new Float32Array(a.slice().buffer),y=new Float32Array(b.slice().buffer);let dot=0,nx=0,ny=0;for(let i=0;i<Math.min(x.length,y.length);i++){dot+=x[i]*y[i];nx+=x[i]*x[i];ny+=y[i]*y[i];}return nx&&ny?1-dot/Math.sqrt(nx*ny):1;}});
 }
 // Statements are kept per SQL, as preparing is not free; one still being iterated gets a fresh copy for the inner use.
 prepare(sql:string){const found=this.statements.get(sql);if(found&&!found.busy)return found;const made=new Statement(this,sql,this.handle.prepare(sql));if(!found)this.statements.set(sql,made);return made;}
 exec(sql:string){this.handle.exec(sql);return this;}
 /** Whether a transaction is open, by SQLite's own account (a BEGIN run through exec counts, as in better-sqlite3). */
 get inTransaction(){return this.open&&capi.sqlite3_get_autocommit(this.handle.pointer)===0;}
 pragma(source:string,options?:{simple?:boolean}){
  // The pool has no shared memory for WAL: the database keeps its default journal, and checkpoints have nothing to do.
  if(/^\s*journal_mode\s*=\s*wal/i.test(source))return options?.simple?'delete':[{journal_mode:'delete'}];
  if(/^\s*wal_checkpoint/i.test(source))return options?.simple?0:[];
  const rows=this.handle.selectObjects(`PRAGMA ${source}`) as Record<string,unknown>[];return options?.simple?(rows[0]?Object.values(rows[0])[0]:undefined):rows;
 }
 transaction<A extends unknown[],R>(fn:(...args:A)=>R){
  const run=(...args:A):R=>{
   const nested=this.depth>0,savepoint=`gumbo_${this.depth}`;this.handle.exec(nested?`SAVEPOINT ${savepoint}`:'BEGIN');this.depth++;
   try{const result=fn(...args);this.depth--;this.handle.exec(nested?`RELEASE ${savepoint}`:'COMMIT');return result;}
   catch(error){this.depth--;try{this.handle.exec(nested?`ROLLBACK TO ${savepoint}; RELEASE ${savepoint}`:'ROLLBACK');}catch{}throw error;}
  };
  return Object.assign(run,{deferred:run,immediate:run,exclusive:run});
 }
 loadExtension(){/* sqlite-vec: its one function used here is registered in the constructor. */}
 async backup(destination:string){writeFileSync(destination,pool.exportFile(this.name));return{totalPages:0,remainingPages:0};}
 function(){throw new Error('Custom SQL functions are not available in the browser build.');}
 close(){if(!this.open)return this;for(const s of this.statements.values())s.finalize();this.statements.clear();this.handle.close();this.open=false;return this;}
}
export namespace Database{export type Database=InstanceType<typeof Database>;export type Statement=InstanceType<typeof Statement>;}
