import React,{useState} from 'react';
import {Settings} from 'lucide-react';
import {SettingsPage} from './SettingsPage';

/** The gear at the top right: it opens Settings, a page of its own over the app (see SettingsPage). */
export function SettingsMenu(){
 const [open,setOpen]=useState(false);
 return <div className="settings-anchor">
  <button type="button" className="settings-button" aria-label="Settings" title="Settings" aria-haspopup="dialog" aria-expanded={open} onClick={()=>setOpen(true)}><Settings size={17}/></button>
  {open&&<SettingsPage onClose={()=>setOpen(false)}/>}
 </div>;
}
