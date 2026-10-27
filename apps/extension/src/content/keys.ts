/// <reference types="chrome" />
/** The key that takes what Tab offers (a suggestion, a move): Alt+Q, so the Tab key stays the page's own. */
export const TAKE_KEY='Alt+Q';
export const takes=(event:KeyboardEvent)=>event.altKey&&event.code==='KeyQ'&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&!event.repeat;
/** Called when Gumbo used the press: it goes no further. */
export function took(event:KeyboardEvent){event.preventDefault();event.stopImmediatePropagation();}
