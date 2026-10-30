import {openDB,type IDBPDatabase} from 'idb';
import {vaultKeys,seal,open,sealBytes,openBytes,hashOf,databaseName,Locked,currentUser,exportKeys,type Box} from './vault';
import {newer,nextStamp,type Outgoing} from '../shared/sync-engine';
import type {Stamp} from '../shared/sync-crypto';
/** Everything Gumbo remembers, in IndexedDB on this computer, sealed (vault.ts): each record is stored as the few things
 * lookups need in the clear (its time, and for some stores what kind of thing it is) plus hashed keys for site and
 * address, and a sealed box with the rest. Every record says where it came from (`source`: the browser today; other
 * apps could feed memory later). Requests take the few snippets they need; nothing is ever sent as a whole. */
export type Source='browser'|'audio'|'import';
export type Writing={id?:number;site:string;url:string;intent:string;label:string;editor:string;text:string;at:number;source:Source;
 /** What it answered: the last message of the conversation above the field, so memory knows what the writing was about. */ replyTo?:string;
 /** The visit it was written on, and that visit's project. */visit?:number;project?:string};
export type SuggestionRecord={id?:number;site:string;intent:string;kind:'text'|'action';text:string;accepted:number;outcome:'accepted'|'partial'|'ignored'|'dismissed'|'undone';latencyMs?:number;at:number;
 /** The memory items the suggestion was made with (their ids in memory's index), so what helped counts next time. */used?:string[]};
/** Something the user did on a page: a click, a choice, a box ticked, a paste, a drag, a page reached. Each points to the one
 * before it in the same tab (prev), so what follows what can be learned; value only where it is safe (an option chosen,
 * a box's state), never what was typed. */
export type ActionEvent={id?:number;site:string;pageKind:string;url:string;kind:'click'|'navigate'|'submit'|'key'|'open'|'type'|'select'|'check'|'paste'|'copy'|'drag'|'switch'|'scroll'|'dialog';role:string;name:string;path?:string;nearby?:string;title?:string;transition?:string;at:number;source:Source;
 tab?:number;visit?:number;prev?:number;value?:string;project?:string};
export type Page={url:string;site:string;title:string;text:string;firstSeen:number;lastSeen:number;visibleMs:number;visits:number;highlights:string[];source:Source};
/** kind 'seen': a piece of the recording of the user's screen (memory/record.ts), its ref `seen:<url>`. */
export type Passage={id?:number;ref:string;kind:'page'|'media'|'writing'|'note'|'import'|'seen';text:string;vector?:number[];at:number;site:string;title:string;url?:string;
 /** The visit it was read on, and how long it was actually in view while they were there (ms). */visit?:number;seenMs?:number};
/** What kind of page a visit was (memory/page-kind.ts). */
export type PageCategory='inbox'|'thread'|'doc'|'search'|'results'|'form'|'dashboard'|'article'|'video'|'chat'|'product'|'checkout'|'settings'|'other';
/** A page in a tab, from when it was reached to when it was left: every navigation (a link, an address typed, a route in
 * an app that never reloads, a new tab opened from another) is one, linked to where it came from (from: the visit before it
 * in the tab, or the one in the tab that opened it). Times are what memory ranks by: active (in front, the window focused,
 * the user not idle), visible (in front in its window) and read (text in view while active). */
export type Visit={id?:number;tab:number;window:number;session:number;url:string;site:string;title:string;pageKind:string;kind:PageCategory;
 in:number;out?:number;activeMs:number;visibleMs:number;readMs:number;from?:number;opener?:number;transition:string;project?:string;events?:number;source:Source};
/** A thread of work across visits (a trip being planned, a bug being fixed, a course): what it is called, and a short
 * rolling note of where it stands, kept by memory/projects.ts. */
export type ProjectNote={goal:string;leftOff:string;open:string[];decisions:string[]};
export type Project={id:string;name:string;note?:ProjectNote;noteAt?:number;notedVisits?:number;notedActiveMs?:number;noteInput?:string;sites:string[];centroid?:number[];firstAt:number;lastAt:number;visits:number;activeMs:number;candidate?:boolean};
export type Segment={start:number;end:number;speaker:string;text:string};
export type Media={id:string;url:string;site:string;title:string;kind:'meeting'|'video'|'audio';startedAt:number;endedAt?:number;segments:Segment[];sounds:{at:number;label:string}[];notes?:string;source:Source;
 /** The voices heard (their fingerprints), so a speaker can be named after the meeting too. */speakers?:{name:string;print:number[];count:number}[]};
export type Voice={id:string;name:string;print:number[];count:number};
export type Note={id?:number;text:string;url?:string;title?:string;at:number;source?:Source};
export type Failure={id?:number;site:string;editor:string;what:'placement'|'insert'|'action'|'context'|'audio'|'model';detail:string;at:number};
/** A conversation in the sidebar: what the user and the agent said and did (for the panel), and the model's messages. */
export type Chat={id:string;title:string;at:number;turns:unknown[];messages:unknown[]};
export type TimingRecord={id?:number;surface:string;ms:number;gateway?:Record<string,number>;at:number;
 /** What the call cost (US dollars), for the cost per day each surface runs up. */usd?:number};

type Value={writing:Writing;suggestions:SuggestionRecord;events:ActionEvent;pages:Page;passages:Passage;media:Media;voices:Voice;notes:Note;failures:Failure;chats:Chat;visits:Visit;projects:Project};
export type Store=keyof Value|'timings';
type Sealed=keyof Value;
/** What each store keeps in the clear for its indexes. A visit's project id is a random id, and brief marks a visit left
 * within seconds with nothing done (what retention drops first). */
const clear:{[S in Sealed]:(v:Value[S])=>Record<string,unknown>}={
 writing:v=>({at:v.at,intent:v.intent}),suggestions:v=>({at:v.at,outcome:v.outcome,kind:v.kind}),events:v=>({at:v.at}),pages:v=>({lastSeen:v.lastSeen,keep:keepOf(v)}),
 passages:v=>({at:v.at,kind:v.kind}),media:v=>({id:v.id,startedAt:v.startedAt}),voices:v=>({id:v.id}),notes:v=>({at:v.at}),failures:v=>({at:v.at}),chats:v=>({id:v.id,at:v.at}),
 visits:v=>({at:v.in,...(v.project?{project:v.project}:{}),brief:v.out!==undefined&&v.activeMs<5000&&!v.events?1:0}),projects:v=>({id:v.id,at:v.lastAt}),
};
/** How long a page is worth keeping when memory runs short (eviction removes the lowest first): when it was last seen,
 * plus a day for each visit and for each two minutes spent on it (up to a month each). Using it in an answer moves it up
 * (touchPages). Only this time is in the clear, never what made it. */
const DAY=86_400_000;
export const keepOf=(p:Page)=>p.lastSeen+Math.min(30,p.visits)*DAY+Math.min(30,Math.floor(p.visibleMs/120_000))*DAY;
/** What syncs between the user's computers (sync.ts): what they wrote, read, heard, noted and asked. Passages and
 * embeddings are made again from these on each computer; the logs and the habits learned stay with the computer. */
export const SYNCED=['writing','notes','chats','voices','media','pages'] as const;
export type Synced=typeof SYNCED[number];
/** What is sent first: what the user made before what they read. */
const PRIORITY:Record<Synced,number>={writing:6,notes:6,chats:5,voices:4,media:3,pages:2};
/** Records named by what is inside them (a page by its address, writing and notes by their time and words, see
 * nameChanges), which a deleted record no longer has; the rest are named by their key. */
const namedInside=(store:Synced)=>store==='pages'||store==='writing'||store==='notes';
/** The change log (database version 5), kept only while sync is on: one change per synced record, written in the same
 * transaction as the record. Its stamp (when, on which computer, which version), whether it is deleted (a tombstone),
 * whether it still has to be sent (dirty, by priority; 0 once sent or when it came from another computer), and its id in
 * the synced copy (sid, given by sync.ts; sidless marks the ones still to be named). Nothing in it says what the record is. */
export type Change=Stamp&{store:Synced;local:IDBValidKey;sid?:string;deleted:0|1;dirty:number;sidless?:1};
const named=({sidless:_,...change}:Change):Change=>change.sid?change:{...change,sidless:1};
/** This computer's id in the synced copy, set while sync is on (sync.ts). */
type Syncing={device:string};
let opened:{user:string;db:Promise<IDBPDatabase>}|undefined;

export async function db():Promise<IDBPDatabase>{
 const user=await currentUser();if(!user)throw new Locked();
 if(opened?.user===user)return opened.db;
 const changeLog=(d:IDBPDatabase)=>{const changes=d.createObjectStore('changes',{keyPath:['store','local']});changes.createIndex('sid','sid');changes.createIndex('dirty',['dirty','at']);changes.createIndex('sidless','sidless');};
 const visitsAndProjects=(d:IDBPDatabase)=>{
  const visits=d.createObjectStore('visits',{keyPath:'id',autoIncrement:true});visits.createIndex('at','at');visits.createIndex('project','project');visits.createIndex('url','url');visits.createIndex('site','site');
  d.createObjectStore('projects',{keyPath:'id'}).createIndex('at','at');
 };
 const promise=openDB(await databaseName(user),6,{async upgrade(d,oldVersion,_newVersion,tx){
  if(oldVersion>=1){
   // Version 2 adds the embedding vectors (keyed by the id of what they embed: a passage, a piece of writing, a note).
   if(oldVersion<2)d.createObjectStore('vectors');
   // Version 3 adds the sidebar's conversations.
   if(oldVersion<3)d.createObjectStore('chats',{keyPath:'id'}).createIndex('at','at');
   // Version 4 orders pages by how long they are worth keeping (pages from before start at when they were last seen).
   if(oldVersion<4){const pages=tx.objectStore('pages');pages.createIndex('keep','keep');for(let c=await pages.openCursor();c;c=await c.continue())if(c.value.keep===undefined)await c.update({...c.value,keep:c.value.lastSeen});}
   // Version 5 adds the change log for sync (empty until sync is turned on).
   if(oldVersion<5)changeLog(d);
   // Version 6 adds visits (every page in every tab, chained) and projects (memory/visits.ts, memory/projects.ts).
   if(oldVersion<6)visitsAndProjects(d);
   return;
  }
  const auto={keyPath:'id',autoIncrement:true} as const;
  const writing=d.createObjectStore('writing',auto);writing.createIndex('site','site');writing.createIndex('intent','intent');writing.createIndex('at','at');
  const suggestions=d.createObjectStore('suggestions',auto);suggestions.createIndex('site','site');suggestions.createIndex('at','at');
  const events=d.createObjectStore('events',auto);events.createIndex('site','site');events.createIndex('at','at');events.createIndex('pageKind','pageKind');
  const pages=d.createObjectStore('pages',{keyPath:'key'});pages.createIndex('site','site');pages.createIndex('lastSeen','lastSeen');pages.createIndex('keep','keep');
  const passages=d.createObjectStore('passages',auto);passages.createIndex('ref','ref');passages.createIndex('at','at');passages.createIndex('site','site');
  const media=d.createObjectStore('media',{keyPath:'id'});media.createIndex('startedAt','startedAt');media.createIndex('url','url');media.createIndex('site','site');
  d.createObjectStore('voices',{keyPath:'id'});
  d.createObjectStore('notes',auto).createIndex('at','at');
  d.createObjectStore('failures',auto).createIndex('at','at');
  d.createObjectStore('timings',auto).createIndex('at','at');
  d.createObjectStore('meta');
  d.createObjectStore('vectors');
  d.createObjectStore('chats',{keyPath:'id'}).createIndex('at','at');
  changeLog(d);visitsAndProjects(d);
 }});
 opened={user,db:promise};return promise;
}
const metaOf=(d:IDBPDatabase)=>({get:(key:string)=>d.get('meta',key),set:async(key:string,value:unknown)=>{await d.put('meta',value,key);}});
async function keysFor(d:IDBPDatabase){return vaultKeys(metaOf(d));}
/** The unwrapped key for the offscreen document (vault.ts useKeys). */
export async function vaultForOffscreen(){return exportKeys(metaOf(await db()));}

/** A record as it is stored: what lookups need in the clear, hashed keys, and the sealed box. */
async function rowOf<S extends Sealed>(k:Awaited<ReturnType<typeof keysFor>>,store:S,value:Value[S]){
 const v:any=value,row:Record<string,unknown>={...clear[store](value as any),box:await seal(k,value)};
 if(v.site!==undefined)row.site=await hashOf(k,v.site);
 if(store==='events')row.pageKind=await hashOf(k,v.pageKind);
 if(store==='pages')row.key=await hashOf(k,v.url);
 if(store==='passages')row.ref=await hashOf(k,v.ref);
 if(store==='media'||store==='visits')row.url=await hashOf(k,v.url);
 if(v.id!==undefined&&(store==='media'||store==='voices'||store==='chats'||store==='projects'))row.id=v.id;
 return row;
}
const isSynced=(store:string):store is Synced=>(SYNCED as readonly string[]).includes(store);
/** Seals and stores a record; returns its key. While sync is on, a synced record's change is noted with it. */
export async function add<S extends Sealed>(store:S,value:Value[S]):Promise<IDBValidKey>{
 const d=await db(),row=await rowOf(await keysFor(d),store,value),keyed=store==='pages'||store==='media'||store==='voices'||store==='chats'||store==='projects';
 if(!isSynced(store))return keyed?d.put(store,row):d.add(store,row);
 const tx=d.transaction([store,'changes','meta'],'readwrite');
 const key=await (keyed?tx.objectStore(store).put(row):tx.objectStore(store).add(row));
 const syncing=await tx.objectStore('meta').get('syncing') as Syncing|undefined;
 if(syncing){
  const changes=tx.objectStore('changes'),prev=await changes.get([store,key]) as Change|undefined;
  await changes.put(named({store,local:key,sid:prev?.sid,...nextStamp(prev,syncing.device),deleted:0,dirty:PRIORITY[store]}));
 }
 await tx.done;return key;
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
/** Stores a record of a store that is never synced under its own id (a visit as it goes on, a passage seen longer). */
export async function save<S extends 'visits'|'passages'|'events'|'suggestions'>(store:S,value:Value[S]&{id:number}):Promise<void>{
 const d=await db(),row=await rowOf(await keysFor(d),store,value);row.id=value.id;await d.put(store,row);
}
export async function getVisit(id:number):Promise<Visit|undefined>{const d=await db(),row=await d.get('visits',id);return row?(await openAll<Visit>(d,[row]))[0]:undefined;}
/** The visits of a project, or of an address, newest first. */
export async function visitsBy(by:{project?:string;url?:string},limit=200):Promise<Visit[]>{
 const d=await db(),k=await keysFor(d),[index,key]=by.project?['project',by.project]:['url',await hashOf(k,by.url!)];
 const rows:any[]=[];for(let c=await d.transaction('visits').store.index(index).openCursor(IDBKeyRange.only(key),'prev');c&&rows.length<limit;c=await c.continue())rows.push(c.value);
 return openAll<Visit>(d,rows);
}
export async function getProject(id:string):Promise<Project|undefined>{const d=await db(),row=await d.get('projects',id);return row?(await openAll<Project>(d,[row]))[0]:undefined;}
export async function allProjects():Promise<Project[]>{const d=await db();return openAll<Project>(d,await d.getAll('projects'));}
export async function removeProject(id:string){await (await db()).delete('projects',id);}
export async function getPage(url:string):Promise<Page|undefined>{
 const d=await db(),k=await keysFor(d),row=await d.get('pages',await hashOf(k,url));
 return row?(await openAll<Page>(d,[row]))[0]:undefined;
}
export async function getChat(id:string):Promise<Chat|undefined>{const d=await db(),row=await d.get('chats',id);return row?(await openAll<Chat>(d,[row]))[0]:undefined;}
export async function removeChat(id:string){await remove('chats',id);}
export async function removeMedia(id:string){await remove('media',id);}
async function remove(store:Synced,key:IDBValidKey){const d=await db(),tx=d.transaction([store,'changes','meta'],'readwrite');await tx.objectStore(store).delete(key);await forgotten(tx,store,[key]);await tx.done;}
/** Synced records the user removed: while sync is on, each one's change becomes a tombstone to send, so the other
 * computers forget it too. One that was never named (sync.ts names them before forgetting) can't be, and is dropped. */
async function forgotten(tx:any,store:Synced,keys:IDBValidKey[]){
 const syncing=await tx.objectStore('meta').get('syncing') as Syncing|undefined;if(!syncing)return;
 const changes=tx.objectStore('changes');
 for(const key of keys){
  const prev=await changes.get([store,key]) as Change|undefined;if(!prev||prev.deleted)continue;
  if(!prev.sid&&namedInside(store)){await changes.delete([store,key]);continue;}
  await changes.put(named({...prev,...nextStamp(prev,syncing.device),deleted:1,dirty:PRIORITY[store]}));
 }
}
export async function getMedia(id:string):Promise<Media|undefined>{const d=await db(),row=await d.get('media',id);return row?(await openAll<Media>(d,[row]))[0]:undefined;}
export async function allVoices():Promise<Voice[]>{const d=await db();return openAll<Voice>(d,await d.getAll('voices'));}
export async function passagesOfRef(ref:string):Promise<Passage[]>{const d=await db(),k=await keysFor(d);return openAll<Passage>(d,await d.getAllFromIndex('passages','ref',await hashOf(k,ref)));}
export async function removePassages(ref:string){const d=await db(),k=await keysFor(d),keys=await d.getAllKeysFromIndex('passages','ref',await hashOf(k,ref));const tx=d.transaction(['passages','vectors'],'readwrite');for(const key of keys){await tx.objectStore('passages').delete(key);await tx.objectStore('vectors').delete('p'+key);}await tx.done;}
/** Pages memory just used (in a suggestion, an answer): kept longer, as the ones that matter. */
export async function touchPages(urls:string[]){
 try{const d=await db(),k=await keysFor(d),until=Date.now()+14*DAY;
  for(const url of urls){const key=await hashOf(k,url),row=await d.get('pages',key);if(row&&(row.keep??0)<until)await d.put('pages',{...row,keep:until});}
 }catch{}
}
/** A single sealed value (what the learner knows, the history import's progress). */
export async function putSealed(key:string,value:unknown){const d=await db(),k=await keysFor(d);await d.put('meta',{sealed:await seal(k,value)},'sealed:'+key);}
export async function getSealed<T>(key:string):Promise<T|undefined>{
 const d=await db(),row=await d.get('meta','sealed:'+key) as {sealed?:Box}|undefined;if(!row?.sealed)return;
 try{return await open<T>(await keysFor(d),row.sealed);}catch{return;}
}
/** Retention (budget.ts): a page not seen for a month keeps only what was actually read of it (passages in view for
 * three seconds or more) and its opening passage; the rest goes, with their embeddings. Done once per page. */
export async function compactOldPages(before:number,limit=200):Promise<number>{
 const d=await db(),keys:IDBValidKey[]=[];
 for(let c=await d.transaction('pages').store.index('lastSeen').openCursor(IDBKeyRange.upperBound(before));c&&keys.length<limit;c=await c.continue())if(!c.value.compact)keys.push(c.primaryKey);
 for(const key of keys){
  const rows=await d.getAllFromIndex('passages','ref',key),passages=await openAll<Passage>(d,rows),first=Math.min(...rows.map(r=>r.id));
  const drop=passages.filter(p=>p.id!==first&&(p.seenMs??0)<3000).map(p=>p.id!);
  const tx=d.transaction(['pages','passages','vectors'],'readwrite');
  for(const id of drop){await tx.objectStore('passages').delete(id);await tx.objectStore('vectors').delete('p'+id);}
  const page=await tx.objectStore('pages').get(key);if(page)await tx.objectStore('pages').put({...page,compact:1});
  await tx.done;
 }
 return keys.length;
}
/** Retention: addresses brought in from Chrome's history that were never visited again (no page was kept for them). */
export async function dropUnvisitedImports(before:number,limit=2000):Promise<number>{
 const d=await db(),tx=d.transaction(['passages','pages','vectors'],'readwrite');let n=0;
 for(let c=await tx.objectStore('passages').index('at').openCursor(IDBKeyRange.upperBound(before));c&&n<limit;c=await c.continue()){
  if(c.value.kind!=='page'||await tx.objectStore('pages').getKey(c.value.ref)!==undefined)continue;
  await tx.objectStore('vectors').delete('p'+c.primaryKey);await c.delete();n++;
 }
 await tx.done;return n;
}
/** Retention for the recording of the screen (memory/record.ts): what was on screen longer ago than `before` goes, with
 * its embeddings (the page it was on keeps its own record). */
export async function dropOldSeen(before:number,limit=5000):Promise<number>{
 const d=await db(),tx=d.transaction(['passages','vectors'],'readwrite');let n=0;
 for(let c=await tx.objectStore('passages').index('at').openCursor(IDBKeyRange.upperBound(before));c&&n<limit;c=await c.continue()){
  if(c.value.kind!=='seen')continue;
  await tx.objectStore('vectors').delete('p'+c.primaryKey);await c.delete();n++;
 }
 await tx.done;return n;
}
/** Bookmarks brought in as notes before Oct 29 (often pages never opened): memory keeps what the user saw, so they go,
 * forgotten on every synced computer too. */
export async function dropBookmarkNotes():Promise<number>{
 const d=await db(),keys=await d.getAllKeys('notes'),notes=await openAll<{text?:string;source?:string}>(d,await d.getAll('notes'));let n=0;
 for(let i=0;i<keys.length;i++)if(notes[i]?.source==='import'&&/^Bookmark( in [^:]*)?: /.test(notes[i]?.text??'')){await remove('notes',keys[i]);n++;}
 return n;
}
/** Retention: visits older than a year, and visits left within seconds with nothing done, after a month. */
export async function dropOldVisits(now=Date.now()):Promise<number>{
 const d=await db(),tx=d.transaction('visits','readwrite');let n=0;
 for(let c=await tx.store.index('at').openCursor(IDBKeyRange.upperBound(now-30*DAY));c&&n<5000;c=await c.continue())if(c.value.at<now-365*DAY||c.value.brief===1){await c.delete();n++;}
 await tx.done;return n;
}
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
 try{const d=await db();const stores:Sealed[]=['writing','suggestions','events','pages','media','notes','passages','visits','projects'];return Object.fromEntries(await Promise.all(stores.map(async s=>[s,await d.count(s)])));}
 catch{return {};}
}
/** Forgets what was kept for a site, since a time, or everything. Voices, notes and projects go only with everything.
 * While sync is on, what is forgotten here is forgotten on the user's other computers too. */
export async function forget({site,since}:{site?:string;since?:number}){
 const d=await db(),k=await keysFor(d),stores:Sealed[]=['writing','suggestions','events','pages','passages','media','visits'];
 if(!site&&!since){
  const tx=d.transaction([...stores,'failures','timings','notes','voices','vectors','chats','projects','changes','meta'],'readwrite');
  const syncing=await tx.objectStore('meta').get('syncing') as Syncing|undefined,changes=tx.objectStore('changes');
  if(syncing)for(let c=await changes.openCursor();c;c=await c.continue()){
   const prev=c.value as Change;if(prev.deleted)continue;
   if(!prev.sid&&namedInside(prev.store))await c.delete();else await c.update(named({...prev,...nextStamp(prev,syncing.device),deleted:1,dirty:PRIORITY[prev.store]}));
  }
  for(const s of tx.objectStoreNames)if(s!=='meta'&&(s!=='changes'||!syncing))await tx.objectStore(s).clear();
  // What was learned from it goes too: the profile, the habits, what Tab learned per site.
  for(const key of ['profile','learner','action-bars','calibration'])await tx.objectStore('meta').delete('sealed:'+key);
  await tx.done;return;
 }
 const hashed=site?await hashOf(k,site):undefined;
 for(const s of stores){
  const tx=d.transaction(isSynced(s)?[s,'changes','meta']:[s],'readwrite'),gone:IDBValidKey[]=[];
  for(let c=await tx.objectStore(s).openCursor();c;c=await c.continue()){
   const v=c.value,at=v.at??v.lastSeen??v.startedAt??0;
   if((!hashed||v.site===hashed)&&(!since||at>=since)){gone.push(c.primaryKey);await c.delete();}
  }
  if(isSynced(s)&&gone.length)await forgotten(tx,s,gone);
  await tx.done;
 }
}
/** Embedding vectors (8-bit, sealed), by the id of what they embed. */
export async function putVectors(entries:[string,Int8Array][]){
 const d=await db(),k=await keysFor(d),sealed=await Promise.all(entries.map(async([id,v])=>[id,await sealBytes(k,new Uint8Array(v.buffer.slice(v.byteOffset,v.byteOffset+v.byteLength)) as Uint8Array<ArrayBuffer>)] as const));
 const tx=d.transaction('vectors','readwrite');for(const [id,box] of sealed)await tx.store.put(box,id);await tx.done;
}
export async function allVectors():Promise<Map<string,Int8Array>>{
 const d=await db(),k=await keysFor(d),out=new Map<string,Int8Array>(),tx=d.transaction('vectors');
 const rows:[string,Box][]=[];for(let c=await tx.store.openCursor();c;c=await c.continue())rows.push([String(c.key),c.value]);
 await Promise.all(rows.map(async([id,box])=>{try{const bytes=await openBytes(k,box);out.set(id,new Int8Array(bytes.buffer,bytes.byteOffset,bytes.byteLength));}catch{}}));
 return out;
}
export async function vectorIds():Promise<Set<string>>{const d=await db();return new Set((await d.getAllKeys('vectors')).map(String));}

/** Sync (sync.ts) works on the change log through these. */
const stampOf=(c:Stamp):Stamp=>({at:c.at,device:c.device,version:c.version});
/** This computer's id while sync is on. */
export async function syncing():Promise<Syncing|undefined>{return (await db()).get('meta','syncing');}
/** Turns the change log on, or off: then it is emptied, as nothing is kept for a sync that is off. */
export async function setSyncing(value:Syncing|undefined){
 const d=await db(),tx=d.transaction(['meta','changes'],'readwrite');
 if(value)await tx.objectStore('meta').put(value,'syncing');else{await tx.objectStore('meta').delete('syncing');await tx.objectStore('changes').clear();}
 await tx.done;
}
/** Every synced record gets a change to send: those from before sync was on get one stamped with their own time (so of
 * two computers' copies of a page, the one seen last wins), and the rest are sent again. Under a new key they are all
 * named again, and tombstones of records named by what was inside them are dropped, as they can't be. */
export async function enroll({rename}:{rename:boolean}){
 const d=await db(),syncing=await d.get('meta','syncing') as Syncing|undefined;if(!syncing)return 0;
 const tx=d.transaction('changes','readwrite');
 for(let c=await tx.store.openCursor();c;c=await c.continue()){
  const v=c.value as Change;if(rename&&v.deleted&&namedInside(v.store)){await c.delete();continue;}
  await c.update(named({...v,sid:rename?undefined:v.sid,dirty:PRIORITY[v.store]}));
 }
 await tx.done;
 const time:Record<Synced,(row:any)=>number>={writing:r=>r.at,notes:r=>r.at,chats:r=>r.at,pages:r=>r.lastSeen,media:r=>r.startedAt,voices:()=>1};
 let added=0;
 for(const store of SYNCED){
  for(let after:IDBValidKey|undefined,more=true;more;){
   const tx=d.transaction([store,'changes'],'readwrite'),changes=tx.objectStore('changes');let n=0;
   for(let c=await tx.objectStore(store).openCursor(after===undefined?undefined:IDBKeyRange.lowerBound(after,true));c&&n<500;c=await c.continue()){
    n++;after=c.primaryKey;
    if(await changes.getKey([store,c.primaryKey])===undefined){await changes.put(named({store,local:c.primaryKey,at:time[store](c.value)||1,device:syncing.device,version:1,deleted:0,dirty:PRIORITY[store]}));added++;}
   }
   await tx.done;more=n===500;await new Promise(r=>setTimeout(r,0));
  }
 }
 return added;
}
/** Names the changes that have no id in the synced copy yet; name(store, what identifies the record) is sync.ts's keyed
 * hash. Records named by what is inside them are opened for it; one that can't be (gone, or a tombstone) is dropped. */
export async function nameChanges(name:(store:Synced,natural:string)=>Promise<string>){
 const d=await db(),k=await keysFor(d);
 for(;;){
  const batch=await d.getAllFromIndex('changes','sidless',1,200) as Change[];if(!batch.length)return;
  const sids:(string|null)[]=[];
  for(const change of batch){
   let natural:string|undefined;
   if(!namedInside(change.store))natural=String(change.local);
   // Notes brought in (bookmarks, another assistant's memory) are named by their words alone: each computer brings in
   // the same ones, and they are one note in the synced copy.
   else if(!change.deleted){const row=await d.get(change.store,change.local);try{const v=row&&await open<any>(k,row.box);if(v)natural=change.store==='pages'?v.url:`${v.source==='import'?'import':v.at}\n${v.text}`;}catch{}}
   sids.push(natural===undefined?null:await name(change.store,natural));
  }
  const tx=d.transaction('changes','readwrite');
  for(const [i,change] of batch.entries()){
   const now=await tx.store.get([change.store,change.local]) as Change|undefined;if(!now?.sidless)continue;
   if(sids[i]===null)await tx.store.delete([change.store,change.local]);else await tx.store.put(named({...now,sid:sids[i]!}));
  }
  await tx.done;
 }
}
/** Up to `limit` changes waiting to be sent, most important and newest first, with what to send: the record as it is
 * here, or nothing for a deletion. A record that is gone (memory made room) has nothing to send and is passed over. */
export async function outgoing(limit:number):Promise<Outgoing[]>{
 const d=await db(),k=await keysFor(d);
 for(;;){
  const picked:Change[]=[];
  for(let c=await d.transaction('changes').store.index('dirty').openCursor(IDBKeyRange.lowerBound([1]),'prev');c&&picked.length<limit;c=await c.continue())if(c.value.sid)picked.push(c.value);
  const out:Outgoing[]=[],passed:Outgoing[]=[],seen=new Set<string>();
  for(const change of picked){
   const item:Outgoing={sid:change.sid!,stamp:stampOf(change),body:{s:change.store}};
   // Two records named the same (the same note twice in a millisecond) are one record in the synced copy.
   if(seen.has(item.sid)){passed.push(item);continue;}seen.add(item.sid);
   if(!change.deleted){
    const row=await d.get(change.store,change.local);let value:any;
    try{value=row&&await open<any>(k,row.box);}catch{}
    if(!value){passed.push(item);continue;}
    if(change.store==='writing'||change.store==='notes')delete value.id;
    item.body.v=value;
   }
   out.push(item);
  }
  if(passed.length)await sent(passed);
  if(out.length||!passed.length)return out;
 }
}
/** Changes the server took: sent, unless they changed again since (then a later push takes them). */
export async function sent(items:Outgoing[]){
 const d=await db(),tx=d.transaction('changes','readwrite');
 for(const item of items)for(const change of await tx.store.index('sid').getAll(item.sid) as Change[])if(change.dirty&&!newer(change,item.stamp))await tx.store.put({...change,dirty:0});
 await tx.done;
}
/** A record from another computer: kept if it is newer than the version here, in one transaction with its change. No
 * value is a deletion (a page's passages and embeddings go with it). True when memory changed here. */
export async function arrive(store:Synced,sid:string,stamp:Stamp,value:any):Promise<boolean>{
 const d=await db(),k=await keysFor(d);
 if(value&&(store==='writing'||store==='notes'))delete value.id;
 const row=value===undefined?undefined:await rowOf(k,store,value);
 // A page is found by its address, a meeting, voice or conversation by its id, writing and notes by their name.
 const local=row&&(store==='pages'?row.key:namedInside(store)?undefined:row.id) as IDBValidKey|undefined;
 const tx=d.transaction(store==='pages'?[store,'changes','meta','passages','vectors']:[store,'changes','meta'],'readwrite'),changes=tx.objectStore('changes');
 if(!await tx.objectStore('meta').get('syncing')){await tx.done;return false;}
 const prev=(local!==undefined?await changes.get([store,local]) as Change|undefined:undefined)??await changes.index('sid').get(sid) as Change|undefined;
 if(prev&&!newer(stamp,prev)){if(!prev.sid)await changes.put(named({...prev,sid}));await tx.done;return false;}
 let changed=false;
 if(row){
  if(prev&&namedInside(store)&&store!=='pages')row.id=prev.local;
  const key=await tx.objectStore(store).put(row);
  await changes.put({store,local:key,sid,...stampOf(stamp),deleted:0,dirty:0});changed=true;
 }else if(prev){
  if(!prev.deleted){
   await tx.objectStore(store).delete(prev.local);changed=true;
   if(store==='pages'){const passages=tx.objectStore('passages');for(const key of await passages.index('ref').getAllKeys(prev.local)){await passages.delete(key);await tx.objectStore('vectors').delete('p'+key);}}
  }
  await changes.put(named({...prev,sid,...stampOf(stamp),deleted:1,dirty:0}));
 }
 await tx.done;return changed;
}
/** How much is waiting to be sent, and how many records the change log follows. */
export async function syncCounts(){const d=await db();return{pending:await d.countFromIndex('changes','dirty',IDBKeyRange.lowerBound([1])),records:await d.count('changes')};}
