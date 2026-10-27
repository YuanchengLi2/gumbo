/// <reference types="chrome" />
/** The key that takes what Tab offers (a suggestion, a move): Alt+Q, so the Tab key stays the page's own. Chrome may hand
 * the key to Gumbo as a command (it then never reaches the page): the engine passes it on to the frame with the focus,
 * which presses it here (pressTake), so the same code takes it either way. */
export const TAKE_KEY='Alt+Q';
export const takes=(event:KeyboardEvent)=>event.altKey&&event.code==='KeyQ'&&!event.ctrlKey&&!event.metaKey&&!event.shiftKey&&!event.repeat;
/** Alt and +: the next of what Tab could offer here (another way to finish the sentence, another likely move); Alt and −
 * goes back. The + key is the =/+ key or the keypad's, with Shift or without. 1 or -1; 0 for any other key. */
export const CYCLE_KEY='Alt++';
export const cycles=(event:KeyboardEvent)=>!event.altKey||event.ctrlKey||event.metaKey||event.isComposing?0:event.code==='Equal'||event.code==='NumpadAdd'||event.key==='+'?1:event.code==='Minus'||event.code==='NumpadSubtract'?-1:0;
let lastTook=0;
/** Called when Gumbo used the press: it goes no further. */
export function took(event:KeyboardEvent){event.preventDefault();event.stopImmediatePropagation();lastTook=Date.now();}
/** The command, pressed where the focus is. Ignored when the page itself just had the key (one press, never two). */
export function pressTake(target:Element|null):{used:boolean}{
 if(Date.now()-lastTook<400)return{used:true};
 const event=new KeyboardEvent('keydown',{key:'q',code:'KeyQ',altKey:true,bubbles:true,cancelable:true,composed:true});
 (target??document.body).dispatchEvent(event);
 return{used:event.defaultPrevented};
}
