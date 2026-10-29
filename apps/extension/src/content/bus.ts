/** Where text Tab and moves meet, within this frame:
 * - tab.ts says when the text in a field is done (the model marked it whole, or a suggestion that finishes it was taken),
 *   and predict.ts offers the next step there at once;
 * - which of the two is on screen, and since when: what the user is looking at is what Tab does, and the other never
 *   replaces it unless the user acts (types, clicks). */
const listeners=new Set<(el:Element)=>void>();
export function onTextDone(listener:(el:Element)=>void){listeners.add(listener);return()=>listeners.delete(listener);}
export function textDone(el:Element){for(const listener of listeners)try{listener(el);}catch{}}

let move:{since:number}|undefined;
/** A move's chip went on screen (or off). */
export function moveShown(on:boolean){move=on?{since:performance.now()}:undefined;}
/** Since when a move's chip has been on screen (undefined: none is). */
export const moveSince=()=>move?.since;
