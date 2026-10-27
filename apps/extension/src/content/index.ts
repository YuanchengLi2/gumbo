/// <reference types="chrome" />
/** The content script, in every frame: finds fields, reads what they are for, shows Tab's ghost and Ctrl+K's card,
 * inserts text so it sticks, captures what memory keeps, and runs actions. Built up in src/content/*. It runs once per
 * frame: the engine also adds it to tabs that were open when Gumbo was installed or updated, where Chrome's own
 * injection may have run already (a copy left from before an update is cut off from the engine, and does not count). */
import {start} from './engine';
const self=globalThis as {gumboLive?:()=>boolean};
if(!self.gumboLive?.()){
 self.gumboLive=()=>{try{return !!chrome.runtime?.id;}catch{return false;}};
 start(window);
}
