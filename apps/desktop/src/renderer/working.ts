import {useEffect,useState} from 'react';
import {useEditor} from './store/editor';

/** Which projects Gumbo is editing right now, for the home screen's spinners: the ones left editing out of sight when
 * another project was opened (the main process says which), and the open project while its request runs. */
let parked:string[]=[];const listeners=new Set<()=>void>();let wired=false;
function wire(){
 if(wired)return;wired=true;
 window.dream.onEvent(raw=>{const event=raw as {type?:string;payload?:{ids?:string[]}};if(event.type==='projects.working'){parked=event.payload?.ids??[];listeners.forEach(l=>l());}});
}
export function useWorking(){
 const [ids,setIds]=useState(parked),current=useEditor(s=>s.project?.aiStatus==='running'?s.project.meta.id:undefined);
 useEffect(()=>{wire();const update=()=>setIds(parked);listeners.add(update);update();return()=>{listeners.delete(update);};},[]);
 return new Set(current?[...ids,current]:ids);
}
