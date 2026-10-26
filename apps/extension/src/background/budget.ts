import {db} from './db';
import {invalidate} from './recall';
/** Memory never weighs the computer down. Once an hour, and only while the computer is idle, in small batches that yield
 * between them:
 * - the logs that grow with every keystroke and click are capped (suggestions, actions, timings, failures);
 * - when everything together passes the budget (2 GB, or a fifth of what Chrome allows the extension, whichever is less),
 *   the pages read longest ago go first, with their passages (their address and title stay in Chrome's own history);
 *   writing, meetings and notes are kept.
 * Everything here works on the sealed rows (times and hashed keys), so nothing is opened to do it. */
const caps:Record<string,number>={suggestions:20_000,events:200_000,timings:5_000,failures:2_000};
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
 const estimate=await navigator.storage.estimate(),budget=Math.min(2*1024**3,(estimate.quota??10*1024**3)*0.2);
 let usage=estimate.usage??0,trimmed=0;
 while(usage>budget){
  // The page read longest ago goes, with its passages.
  const tx=d.transaction(['pages','passages'],'readwrite');
  const oldest=await tx.objectStore('pages').index('lastSeen').openCursor();if(!oldest){await tx.done;break;}
  const page=oldest.value;
  const passages=await tx.objectStore('passages').index('ref').getAllKeys(page.key);
  for(const key of passages)await tx.objectStore('passages').delete(key);
  await oldest.delete();await tx.done;trimmed++;
  if(trimmed%50===0){usage=(await navigator.storage.estimate()).usage??0;await yieldNow();}
  if(trimmed>5000)break;
 }
 if(removed||trimmed)invalidate();
 return{removed,trimmed,usage,budget};
}
chrome.alarms.onAlarm.addListener(alarm=>{if(alarm.name==='memory-budget')void keepWithinBudget().catch(()=>{});});
void chrome.alarms.get('memory-budget').then(alarm=>{if(!alarm)void chrome.alarms.create('memory-budget',{periodInMinutes:60,delayInMinutes:5});});
