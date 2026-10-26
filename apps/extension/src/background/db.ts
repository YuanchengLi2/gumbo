import {openDB,type IDBPDatabase} from 'idb';
import {session} from './auth';
import {vaultKeys,seal,open,hashOf,databaseName,Locked,type Box} from './vault';
/** Everything Gumbo remembers, in IndexedDB on this computer, sealed (vault.ts): each record is stored as the few things
 * lookups need in the clear (its time, and for some stores what kind of thing it is) plus hashed keys for site and
 * address, and a sealed box with the rest. Every record says where it came from (`source`: the browser today; other
 * apps could feed memory later). Requests take the few snippets they need; nothing is ever sent as a whole. */
export type Source='browser'|'audio'|'import';
export type Writing={id?:number;site:string;url:string;intent:string;label:string;editor:string;text:string;at:number;source:Source};
export type SuggestionRecord={id?:number;site:string;intent:string;kind:'text'|'action';text:string;accepted:number;outcome:'accepted'|'partial'|'ignored'|'dismissed';latencyMs?:number;at:number};
export type ActionEvent={id?:number;site:string;pageKind:string;url:string;kind:'click'|'navigate'|'submit'|'key'|'open';role:string;name:string;path?:string;nearby?:string;title?:string;transition?:string;at:number;source:Source};
export type Page={url:string;site:string;title:string;text:string;firstSeen:number;lastSeen:number;visibleMs:number;visits:number;highlights:string[];source:Source};
export type Passage={id?:number;ref:string;kind:'page'|'media'|'writing'|'note'|'import';text:string;vector?:number[];at:number;site:string;title:string;url?:string};
export type Segment={start:number;end:number;speaker:string;text:string};
export type Media={id:string;url:string;site:string;title:string;kind:'meeting'|'video'|'audio';startedAt:number;endedAt?:number;segments:Segment[];sounds:{at:number;label:string}[];notes?:string;source:Source};
export type Voice={id:string;name:string;print:number[];count:number};
export type Note={id?:number;text:string;url?:string;title?:string;at:number;source?:Source};
export type Failure={id?:number;site:string;editor:string;what:'placement'|'insert'|'action'|'context'|'audio'|'model';detail:string;at:number};
export type TimingRecord={id?:number;surface:string;ms:number;gateway?:Record<string,number>;at:number};

type Value={writing:Writing;suggestions:SuggestionRecord;events:ActionEvent;pages:Page;passages:Passage;media:Media;voices:Voice;notes:Note;failures:Failure};
export type Store=keyof Value|'timings';
type Sealed=keyof Value;
/** What each store keeps in the clear for its indexes. */
const clear:{[S in Sealed]:(v:Value[S])=>Record<string,unknown>}={
 writing:v=>({at:v.at,intent:v.intent}),suggestions:v=>({at:v.at,outcome:v.outcome,kind:v.kind}),events:v=>({at:v.at}),pages:v=>({lastSeen:v.lastSeen}),
 passages:v=>({at:v.at,kind:v.kind}),media:v=>({id:v.id,startedAt:v.startedAt}),voices:v=>({id:v.id}),notes:v=>({at:v.at}),failures:v=>({at:v.at}),
};
let opened:{user:string;db:Promise<IDBPDatabase>}|undefined;

export async function db():Promise<IDBPDatabase>{
 const now=await session();if(!now)throw new Locked();
 if(opened?.user===now.user.id)return opened.db;
 const promise=openDB(await databaseName(now.user.id),1,{upgrade(d){
  const auto={keyPath:'id',autoIncrement:true} as const;
  const writing=d.createObjectStore('writing',auto);writing.createIndex('site','site');writing.createIndex('intent','intent');writing.createIndex('at','at');
  const suggestions=d.createObjectStore('suggestions',auto);suggestions.createIndex('site','site');suggestions.createIndex('at','at');
  const events=d.createObjectStore('events',auto);events.createIndex('site','site');events.createIndex('at','at');events.createIndex('pageKind','pageKind');
  const pages=d.createObjectStore('pages',{keyPath:'key'});pages.createIndex('site','site');pages.createIndex('lastSeen','lastSeen');
  const passages=d.createObjectStore('passages',auto);passages.createIndex('ref','ref');passages.createIndex('at','at');passages.createIndex('site','site');
  const media=d.createObjectStore('media',{keyPath:'id'});media.createIndex('startedAt','startedAt');media.createIndex('url','url');media.createIndex('site','site');
  d.createObjectStore('voices',{keyPath:'id'});
  d.createObjectStore('notes',auto).createIndex('at','at');
  d.createObjectStore('failures',auto).createIndex('at','at');
  d.createObjectStore('timings',auto).createIndex('at','at');
  d.createObjectStore('meta');
 }});
 opened={user:now.user.id,db:promise};return promise;
}
const metaOf=(d:IDBPDatabase)=>({get:(key:string)=>d.get('meta',key),set:async(key:string,value:unknown)=>{await d.put('meta',value,key);}});
async function keysFor(d:IDBPDatabase){return vaultKeys(metaOf(d));}

/** Seals and stores a record; returns its key. */
export async function add<S extends Sealed>(store:S,value:Value[S]):Promise<IDBValidKey>{
 const d=await db(),k=await keysFor(d),v:any=value;
 const row:Record<string,unknown>={...clear[store](value as any),box:await seal(k,value)};
 if(v.site!==undefined)row.site=await hashOf(k,v.site);
 if(store==='events')row.pageKind=await hashOf(k,v.pageKind);
 if(store==='pages')row.key=await hashOf(k,v.url);
 if(store==='passages')row.ref=await hashOf(k,v.ref);
 if(store==='media')row.url=await hashOf(k,v.url);
 if(v.id!==undefined&&(store==='media'||store==='voices'))row.id=v.id;
 return store==='pages'||store==='media'||store==='voices'?d.put(store,row):d.add(store,row);
}
/** Opens stored rows into records (rows that fail to open, from another key, are skipped). */
async function openAll<T>(d:IDBPDatabase,rows:any[]):Promise<T[]>{
 const k=await keysFor(d),out:T[]=[];
 for(const row of rows){try{const value=await open<any>(k,row.box as Box);if(row.id!==undefined)value.id=row.id;out.push(value);}catch{}}
 return out;
}
/** The newest records of a store, newest first. */
export async function recent<S extends Sealed>(store:S,limit:number,since=0,index:string=store==='pages'?'lastSeen':store==='media'?'startedAt':'at'):Promise<Value[S][]>{
 const d=await db(),rows:any[]=[];
 for(let c=await d.transaction(store).store.index(index).openCursor(IDBKeyRange.lowerBound(since),'prev');c&&rows.length<limit;c=await c.continue())rows.push(c.value);
 return openAll<Value[S]>(d,rows);
}
/** Records of one site, newest first. */
export async function forSite<S extends 'writing'|'suggestions'|'events'|'pages'|'passages'|'media'>(store:S,site:string,limit:number):Promise<Value[S][]>{
 const d=await db(),k=await keysFor(d),rows=await d.getAllFromIndex(store,'site',await hashOf(k,site));
 return(await openAll<Value[S]>(d,rows.reverse().slice(0,limit)));
}
export async function getPage(url:string):Promise<Page|undefined>{
 const d=await db(),k=await keysFor(d),row=await d.get('pages',await hashOf(k,url));
 return row?(await openAll<Page>(d,[row]))[0]:undefined;
}
export async function getMedia(id:string):Promise<Media|undefined>{const d=await db(),row=await d.get('media',id);return row?(await openAll<Media>(d,[row]))[0]:undefined;}
export async function allVoices():Promise<Voice[]>{const d=await db();return openAll<Voice>(d,await d.getAll('voices'));}
export async function passagesOfRef(ref:string):Promise<Passage[]>{const d=await db(),k=await keysFor(d);return openAll<Passage>(d,await d.getAllFromIndex('passages','ref',await hashOf(k,ref)));}
export async function removePassages(ref:string){const d=await db(),k=await keysFor(d),keys=await d.getAllKeysFromIndex('passages','ref',await hashOf(k,ref));const tx=d.transaction('passages','readwrite');for(const key of keys)await tx.store.delete(key);await tx.done;}
/** Timings are not about the user's content: kept in the clear for the meters. */
export async function addTiming(value:TimingRecord){try{await (await db()).add('timings',value);}catch{}}
export async function recentTimings(limit:number,since=0):Promise<TimingRecord[]>{
 const d=await db(),out:TimingRecord[]=[];
 for(let c=await d.transaction('timings').store.index('at').openCursor(IDBKeyRange.lowerBound(since),'prev');c&&out.length<limit;c=await c.continue())out.push(c.value);
 return out;
}
/** Counts in the clear (outcome) without opening anything. */
export async function suggestionOutcomes(since:number){
 const d=await db(),out:{outcome:string;kind:string}[]=[];
 for(let c=await d.transaction('suggestions').store.index('at').openCursor(IDBKeyRange.lowerBound(since));c;c=await c.continue())out.push({outcome:c.value.outcome,kind:c.value.kind});
 return out;
}
export async function counts(){
 try{const d=await db();const stores:Sealed[]=['writing','suggestions','events','pages','media','notes','passages'];return Object.fromEntries(await Promise.all(stores.map(async s=>[s,await d.count(s)])));}
 catch{return {};}
}
/** Forgets what was kept for a site, since a time, or everything. Voices and notes go only with everything. */
export async function forget({site,since}:{site?:string;since?:number}){
 const d=await db(),k=await keysFor(d),stores:Sealed[]=['writing','suggestions','events','pages','passages','media'];
 if(!site&&!since){const tx=d.transaction([...stores,'failures','timings','notes','voices'],'readwrite');for(const s of tx.objectStoreNames)await tx.objectStore(s).clear();await tx.done;return;}
 const hashed=site?await hashOf(k,site):undefined;
 for(const s of stores){
  const tx=d.transaction(s,'readwrite');
  for(let c=await tx.store.openCursor();c;c=await c.continue()){
   const v=c.value,at=v.at??v.lastSeen??v.startedAt??0;
   if((!hashed||v.site===hashed)&&(!since||at>=since))await c.delete();
  }
  await tx.done;
 }
}
