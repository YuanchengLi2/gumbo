/** On the web Roux's runs and exports happen in this tab, not on a server: while one goes on, the screen is kept awake
 * (a Wake Lock, taken again whenever the tab is shown, since a hidden tab loses it) and closing or leaving the page asks
 * first. Each kind of work holds its own reason, so one ending does not release another. */
const reasons=new Set<string>();let lock:WakeLockSentinel|undefined;
async function hold(){
 if(lock||document.visibilityState!=='visible')return;
 try{lock=await navigator.wakeLock.request('screen');lock.addEventListener('release',()=>{lock=undefined;});}catch{}
}
const ask=(event:BeforeUnloadEvent)=>{event.preventDefault();event.returnValue='';};
export function busy(reason:string,on:boolean){
 const before=reasons.size;if(on)reasons.add(reason);else reasons.delete(reason);
 if(reasons.size&&!before){void hold();addEventListener('beforeunload',ask);}
 if(!reasons.size&&before){void lock?.release();lock=undefined;removeEventListener('beforeunload',ask);}
}
document.addEventListener('visibilitychange',()=>{if(reasons.size&&document.visibilityState==='visible')void hold();});
/** Asks the browser to keep this site's storage (projects, footage) instead of clearing it when the disk runs short. */
export async function keepStorage(){try{if(!await navigator.storage.persisted())await navigator.storage.persist();}catch{}}
