import React,{useEffect,useState} from 'react';
import {createPortal} from 'react-dom';
import {Settings} from 'lucide-react';
import {SettingsPage} from './SettingsPage';

/** Whether Settings is open, for the whole app: the gear in the home screen and in the editor's header are different
 * components (one replaces the other when a project opens), and Settings stays open across that. */
let open=false;const listeners=new Set<()=>void>();
const setOpen=(value:boolean)=>{open=value;listeners.forEach(l=>l());};

/** The gear at the top right: it opens Settings, a page of its own over the app (see SettingsPage), drawn at the top of
 * the document rather than inside the header (a window-drag area on Windows) that holds the gear. */
export function SettingsMenu(){
 const [isOpen,setIsOpen]=useState(open);
 useEffect(()=>{const update=()=>setIsOpen(open);listeners.add(update);update();return()=>{listeners.delete(update);};},[]);
 return <div className="settings-anchor">
  <button type="button" className="settings-button" aria-label="Settings" title="Settings" aria-haspopup="dialog" aria-expanded={isOpen} onClick={()=>setOpen(true)}><Settings size={17}/></button>
 </div>;
}
/** Settings itself, mounted once at the top of the app. */
export function SettingsLayer(){
 const [isOpen,setIsOpen]=useState(open);
 useEffect(()=>{const update=()=>setIsOpen(open);listeners.add(update);return()=>{listeners.delete(update);};},[]);
 return isOpen?createPortal(<SettingsPage onClose={()=>setOpen(false)}/>,document.body):null;
}
