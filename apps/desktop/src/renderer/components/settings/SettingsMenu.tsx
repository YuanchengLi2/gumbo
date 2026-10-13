import React,{useEffect,useRef,useState} from 'react';
import {Settings,Sun,Moon,Monitor} from 'lucide-react';
import {useTheme,setThemeChoice,type ThemeChoice} from '../../theme';
import {shortcutHints} from '../../shortcuts';

/** Settings at the top right, as in Claude Code: a gear that opens a small menu with the appearance (Light, Dark or
 * System) and the keyboard shortcuts. */
const themes:[ThemeChoice,string,typeof Sun][]=[['light','Light',Sun],['dark','Dark',Moon],['system','System',Monitor]];
const shortcuts:[string,string][]=[[shortcutHints.chat+' or /','Type in the chat'],[shortcutHints.mode,'Edit, Plan or Ask'],['Ctrl+1 / 2 / 3','Edit / Plan / Ask'],[shortcutHints.model,'Next model'],['Space','Play or pause'],['Ctrl+B','Split at playhead'],['Ctrl+D','Duplicate'],['Delete','Delete selection'],['Ctrl+Z','Undo']];

export function SettingsMenu(){
 const [open,setOpen]=useState(false),ref=useRef<HTMLDivElement>(null),choice=useTheme();
 useEffect(()=>{if(!open)return;const close=(e:MouseEvent)=>{if(!ref.current?.contains(e.target as Node))setOpen(false);},key=(e:KeyboardEvent)=>{if(e.key==='Escape')setOpen(false);};
  document.addEventListener('mousedown',close);document.addEventListener('keydown',key);return()=>{document.removeEventListener('mousedown',close);document.removeEventListener('keydown',key);};},[open]);
 return <div className="settings-anchor" ref={ref}>
  <button type="button" className="settings-button" aria-label="Settings" title="Settings" aria-haspopup="menu" aria-expanded={open} onClick={()=>setOpen(!open)}><Settings size={17}/></button>
  {open&&<div className="settings-menu" role="menu" aria-label="Settings">
   <section><h3>Appearance</h3>
    <div className="settings-segments" role="radiogroup" aria-label="Appearance">{themes.map(([id,label,Icon])=><button key={id} type="button" role="radio" aria-checked={choice===id} className={choice===id?'selected':''} onClick={()=>setThemeChoice(id)}><Icon size={14}/>{label}</button>)}</div>
   </section>
   <section><h3>Keyboard shortcuts</h3>
    <dl className="settings-shortcuts">{shortcuts.map(([keys,what])=><React.Fragment key={keys}><dt>{what}</dt><dd><kbd>{keys}</kbd></dd></React.Fragment>)}</dl>
   </section>
  </div>}
 </div>;
}
