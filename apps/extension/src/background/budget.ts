import {db,compactOldPages,dropUnvisitedImports,dropOldVisits,dropBookmarkNotes,dropOldSeen,getSealed,putSealed} from './db';
import {invalidate} from './recall';
/** Memory never weighs the computer down. Once an hour, and only while the computer is idle, in small batches that yield
 * between them:
 * - the logs that grow with every keystroke and click are capped (suggestions, actions, timings, failures), and so are
 *   writing, notes and conversations (the oldest go first);
 * - visits are kept a year, and those left within seconds with nothing done, a month;
 * - a page not seen for a month keeps only what was read of it (and its opening); addresses brought in from Chrome's
 *   history (before Oct 29) with no page of them kept go, and so do the bookmarks once brought in as notes;
 * - when everything together passes the budget (1 GB, or a tenth of what Chrome allows on this disk, whichever is
 *   less), the pages least worth keeping go first (least recently seen or used in an answer, fewest visits, least time
 *   on them), with their passages and embeddings (their address and title stay in Chrome's own history); writing,
 *   meetings and notes are kept. Records are compressed before they are sealed, so this is rarely reached.
 * Everything here works on the sealed rows (times and hashed keys), so nothing is opened to do it. */
const caps:Record<string,number>={suggestions:20_000,events:200_000,timings:5_000,failures:2_000,writing:50_000,notes:50_000,chats:1_000};
const DAY=86_400_000;
const yieldNow=()=>new Promise(resolve=>setTimeout(resolve,0));

export async function keepWithinBudget({force=false}:{force?:boolean}={}){
 if(!force&&chrome.idle&&await chrome.idle.queryState(120)==='active')return{skipped:'busy'};
 const d=await db();let removed=0;
 for(const [store,cap] of Object.entries(caps)){
  const count=await d.count(store);if(count<=cap)continue;
  let over=count-cap;
  while(over>0){
   const tx=d.transaction(store,'readwrite');let batch=0;
   for(let c=await tx.store.index('at').openCursor();c&&batch<500&&over>0;c=await c.continue()){await c.delete();batch++;over--;removed++;}
   await tx.done;await yieldNow();if(!batch)break;
  }
 }
 const now=Date.now();
 removed+=await dropOldVisits(now).catch(()=>0);await yieldNow();
 const compacted=await compactOldPages(now-30*DAY).catch(()=>0);await yieldNow();
 // Memory holds what the user saw: addresses brought in from Chrome's history with no page of them kept go at once, and
 // the bookmarks once brought in as notes go the first time this runs.
 removed+=await dropUnvisitedImports(now).catch(()=>0);
 // The recording of the screen keeps half a year.
 removed+=await dropOldSeen(now-180*DAY).catch(()=>0);
 if(!await getSealed<number>('bookmarks-dropped').catch(()=>1)){removed+=await dropBookmarkNotes().catch(()=>0);await putSealed('bookmarks-dropped',now).catch(()=>{});}
 if(compacted)removed++;
 // A gigabyte at most, and never more than a tenth of what Chrome allows on this disk.
 const estimate=await navigator.storage.estimate(),budget=Math.min(1024**3,(estimate.quota??10*1024**3)*0.1);
 let usage=estimate.usage??0,trimmed=0;
 while(usage>budget){
  // The page least worth keeping goes (least recently seen or used, fewest visits, least time on it), with its
  // passages and their embeddings.
  const tx=d.transaction(['pages','passages','vectors'],'readwrite');
  const oldest=await tx.objectStore('pages').index('keep').openCursor();if(!oldest){await tx.done;break;}
  const page=oldest.value;
  const passages=await tx.objectStore('passages').index('ref').getAllKeys(page.key);
  for(const key of passages){await tx.objectStore('passages').delete(key);await tx.objectStore('vectors').delete('p'+key);}
  await oldest.delete();await tx.done;trimmed++;
  if(trimmed%50===0){usage=(await navigator.storage.estimate()).usage??0;await yieldNow();}
  if(trimmed>5000)break;
 }
 if(removed||trimmed)invalidate();
 return{removed,trimmed,usage,budget};
}
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name==='memory-budget')void keepWithinBudget().catch(()=>{});});
void chrome.alarms.get('memory-budget').then(alarm=>{if(!alarm)void chrome.alarms.create('memory-budget',{periodInMinutes:60,delayInMinutes:5});});
