import {useEffect} from 'react';
import {useEditor,type Permission,type ModelChoice} from './store/editor';
import {available} from './models';

/** Keyboard shortcuts for talking to Gumbo, on the home screen and in a project:
 * Ctrl+L (or / when not typing) puts the cursor in the chat box; Shift+Tab in the chat box, or Ctrl+1/2/3 anywhere, picks
 * Edit, Plan or Ask; Ctrl+Shift+M steps through the models. (Cmd instead of Ctrl on a Mac.) */
export const modes:Permission[]=['auto','plan','ask'];
// Roux 1 (auto) first; the models it runs on and GPT-6 Luna are not offered on their own (models.ts).
export const modelOrder:ModelChoice[]=['auto','sonnet','opus','gpt-astra','gpt-sol','gemini-argon','gemini-flash'];
export const shortcutHints={chat:'Ctrl+L',mode:'Shift+Tab',model:'Ctrl+Shift+M'};
const next=<T,>(list:T[],value:T)=>list[(list.indexOf(value)+1)%list.length];
export function useChatShortcuts(){
 useEffect(()=>{
  const key=(e:KeyboardEvent)=>{
   const target=e.target as HTMLElement|null,mod=e.ctrlKey||e.metaKey,store=useEditor.getState(),chat=document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Ask Gumbo to edit"]');
   const typing=!!target?.closest('input,textarea,select,[contenteditable]'),inChat=!!chat&&target===chat;
   if(mod&&!e.shiftKey&&!e.altKey&&e.key.toLowerCase()==='l'||!mod&&!typing&&e.key==='/'){if(!chat)return;e.preventDefault();chat.focus();chat.setSelectionRange(chat.value.length,chat.value.length);return;}
   if(inChat&&e.shiftKey&&!mod&&e.key==='Tab'){e.preventDefault();store.setPermission(next(modes,store.permission));return;}
   if(mod&&!e.shiftKey&&!e.altKey&&['1','2','3'].includes(e.key)){e.preventDefault();store.setPermission(modes[Number(e.key)-1]);return;}
   if(mod&&e.shiftKey&&!e.altKey&&e.key.toLowerCase()==='m'){e.preventDefault();const ready=modelOrder.filter(c=>available(c));store.setModel(next(ready,ready.includes(store.model)?store.model:'auto'));}
  };
  window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);
 },[]);
}
