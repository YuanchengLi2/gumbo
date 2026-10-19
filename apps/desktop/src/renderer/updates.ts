import {useEffect,useState} from 'react';
import type {UpdateStatus} from '@dream/contracts';

/** The new version of Gumbo downloading in the background (main/updates.ts). The profile menu offers a restart once it is
 * ready; until then nothing shows. */
let current:UpdateStatus={status:'idle'};const listeners=new Set<()=>void>();let wired=false;
const set=(next:UpdateStatus)=>{current=next;listeners.forEach(l=>l());};
function wire(){
 if(wired)return;wired=true;
 window.dream.onEvent(raw=>{if(raw.type==='app.update')set(raw.payload as UpdateStatus);});
 void window.dream.update?.().then(set,()=>{});
}
export function useUpdate(){
 const [status,setStatus]=useState(current);
 useEffect(()=>{wire();const update=()=>setStatus(current);listeners.add(update);update();return()=>{listeners.delete(update);};},[]);
 return status;
}
/** Restarts into the downloaded version; the reason when it cannot yet (an edit is running). */
export async function restartToUpdate(){const result=await window.dream.restartToUpdate();return result.restarted?undefined:result.reason??'Gumbo could not restart yet.';}
