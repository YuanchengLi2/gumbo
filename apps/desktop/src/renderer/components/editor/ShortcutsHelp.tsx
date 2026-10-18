import React,{useEffect} from 'react';
import {X} from 'lucide-react';
import {EDITOR_SHORTCUTS} from '../../manual/shortcuts';

/** Every editor shortcut in one sheet, opened with ?: the keyboard is the editor's toolbar. */
export function ShortcutsHelp({onClose}:{onClose:()=>void}){
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();onClose();}};window.addEventListener('keydown',key,true);return()=>window.removeEventListener('keydown',key,true);},[onClose]);
 const groups=[...new Set(EDITOR_SHORTCUTS.map(s=>s.group))];
 return <div className="shortcuts-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)onClose();}}><section className="shortcuts-sheet" role="dialog" aria-label="Keyboard shortcuts">
  <header><h2>Keyboard shortcuts</h2><button type="button" className="icon-button" aria-label="Close shortcuts" onClick={onClose}><X size={16}/></button></header>
  <div className="shortcuts-groups">{groups.map(group=><div key={group}><h3>{group}</h3>{EDITOR_SHORTCUTS.filter(s=>s.group===group).map(s=><p key={s.label}><span>{s.label}</span><span>{s.keys.map(k=><kbd key={k}>{k}</kbd>)}</span></p>)}</div>)}</div>
 </section></div>;
}
