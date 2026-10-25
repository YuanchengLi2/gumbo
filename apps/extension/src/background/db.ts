import {openDB,type DBSchema,type IDBPDatabase} from 'idb';
/** Everything Gumbo remembers, in IndexedDB on this computer. Every record says where it came from (`source`: the
 * browser today; other apps could feed memory later) and when. Nothing here is ever sent anywhere as a whole: requests
 * take the few snippets they need. */
export type Source='browser'|'audio';
/** Text the user wrote: a field's final text when it lost focus or was sent. */
export type Writing={id?:number;site:string;url:string;intent:string;label:string;editor:string;text:string;at:number;source:Source};
/** One Tab suggestion and what became of it. */
export type SuggestionRecord={id?:number;site:string;intent:string;kind:'text'|'action';text:string;accepted:number;outcome:'accepted'|'partial'|'ignored'|'dismissed';latencyMs?:number;at:number};
/** A click, a navigation or a submit, as the learner sees it. */
export type ActionEvent={id?:number;site:string;pageKind:string;url:string;kind:'click'|'navigate'|'submit'|'key'|'open';role:string;name:string;path?:string;nearby?:string;title?:string;transition?:string;at:number;source:Source};
export type Page={url:string;site:string;title:string;text:string;firstSeen:number;lastSeen:number;visibleMs:number;highlights:string[];source:Source};
export type Passage={id?:number;ref:string;kind:'page'|'media'|'writing'|'note';text:string;vector?:Int8Array;at:number;site:string;title:string};
export type Segment={start:number;end:number;speaker:string;text:string};
export type Media={id:string;url:string;site:string;title:string;kind:'meeting'|'video';startedAt:number;endedAt?:number;segments:Segment[];sounds:{at:number;label:string}[];notes?:string;source:Source};
export type Voice={id:string;name:string;print:number[];count:number};
export type Note={id?:number;text:string;url?:string;title?:string;at:number};
export type Failure={id?:number;site:string;editor:string;what:'placement'|'insert'|'action'|'context'|'audio';detail:string;at:number};
export type TimingRecord={id?:number;surface:string;ms:number;gateway?:Record<string,number>;at:number};

interface Schema extends DBSchema{
 writing:{key:number;value:Writing;indexes:{site:string;intent:string;at:number}};
 suggestions:{key:number;value:SuggestionRecord;indexes:{site:string;at:number}};
 events:{key:number;value:ActionEvent;indexes:{site:string;at:number;pageKind:string}};
 pages:{key:string;value:Page;indexes:{site:string;lastSeen:number}};
 passages:{key:number;value:Passage;indexes:{ref:string;at:number}};
 media:{key:string;value:Media;indexes:{startedAt:number;url:string}};
 voices:{key:string;value:Voice};
 notes:{key:number;value:Note;indexes:{at:number}};
 failures:{key:number;value:Failure;indexes:{at:number}};
 timings:{key:number;value:TimingRecord;indexes:{at:number}};
 meta:{key:string;value:unknown};
}
export type Store='writing'|'suggestions'|'events'|'pages'|'passages'|'media'|'voices'|'notes'|'failures'|'timings';
let opened:Promise<IDBPDatabase<Schema>>|undefined;
export function db(){
 return opened??=openDB<Schema>('gumbo',1,{upgrade(d){
  const auto={keyPath:'id',autoIncrement:true} as const;
  const writing=d.createObjectStore('writing',auto);writing.createIndex('site','site');writing.createIndex('intent','intent');writing.createIndex('at','at');
  const suggestions=d.createObjectStore('suggestions',auto);suggestions.createIndex('site','site');suggestions.createIndex('at','at');
  const events=d.createObjectStore('events',auto);events.createIndex('site','site');events.createIndex('at','at');events.createIndex('pageKind','pageKind');
  const pages=d.createObjectStore('pages',{keyPath:'url'});pages.createIndex('site','site');pages.createIndex('lastSeen','lastSeen');
  const passages=d.createObjectStore('passages',auto);passages.createIndex('ref','ref');passages.createIndex('at','at');
  const media=d.createObjectStore('media',{keyPath:'id'});media.createIndex('startedAt','startedAt');media.createIndex('url','url');
  d.createObjectStore('voices',{keyPath:'id'});
  d.createObjectStore('notes',auto).createIndex('at','at');
  d.createObjectStore('failures',auto).createIndex('at','at');
  d.createObjectStore('timings',auto).createIndex('at','at');
  d.createObjectStore('meta');
 }});
}
/** The newest records of a store, newest first. */
export async function recent<S extends 'writing'|'suggestions'|'events'|'failures'|'timings'|'notes'>(store:S,limit:number,since=0){
 const tx=(await db()).transaction(store);const out:Schema[S]['value'][]=[];
 for(let cursor=await tx.store.index('at').openCursor(IDBKeyRange.lowerBound(since),'prev');cursor&&out.length<limit;cursor=await cursor.continue())out.push(cursor.value);
 return out;
}
/** How much is kept, for the popup. */
export async function counts(){
 const d=await db(),stores:Store[]=['writing','suggestions','events','pages','media','notes'];
 return Object.fromEntries(await Promise.all(stores.map(async s=>[s,await d.count(s)])));
}
/** Forgets what was kept for a site, since a time, or everything. Voices and notes go only with everything. */
export async function forget({site,since}:{site?:string;since?:number}){
 const d=await db(),bySite:Store[]=['writing','suggestions','events','pages','passages','media'];
 const tx=d.transaction([...bySite,'failures','timings','notes','voices'],'readwrite');
 if(!site&&!since){for(const s of [...bySite,'failures','timings','notes','voices'] as Store[])await tx.objectStore(s).clear();await tx.done;return;}
 for(const s of bySite){
  for(let cursor=await tx.objectStore(s).openCursor();cursor;cursor=await cursor.continue()){
   const v:any=cursor.value,at=v.at??v.lastSeen??v.startedAt??0;
   if((!site||v.site===site)&&(!since||at>=since))await cursor.delete();
  }
 }
 await tx.done;
}
