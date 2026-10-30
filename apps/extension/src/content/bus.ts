/** Where text Tab and moves meet, within this frame. Tab offers one thing at a time, the one most likely right:
 * - tab.ts says when the text in a field is done (the model marked it whole, or a suggestion that finishes it was taken),
 *   and predict.ts offers the next step there at once;
 * - which of the two is on screen, since when, and how sure each is: what the user is looking at is what Tab does, and the
 *   other replaces it only when it is much surer (a move the engine is sure of over words it was unsure of);
 * - a move that would only type into the field they are in is words in that field: it is offered as the ghost is
 *   (offerWords), taken with Tab like any suggestion. */
const listeners=new Set<(el:Element)=>void>();
export function onTextDone(listener:(el:Element)=>void){listeners.add(listener);return()=>listeners.delete(listener);}
export function textDone(el:Element){for(const listener of listeners)try{listener(el);}catch{}}

let move:{since:number;confidence:number}|undefined;
/** A move's chip went on screen (or off), and how sure the engine is of it. */
export function moveShown(on:boolean,confidence=0){move=on?{since:performance.now(),confidence}:undefined;}
/** Since when a move's chip has been on screen (undefined: none is). */
export const moveSince=()=>move?.since;
export const moveConfidence=()=>move?.confidence;

let words:{confidence:number}|undefined;
/** Ghost words went on screen (or off), and how sure the text model was of them (0 to 1). */
export function wordsShown(on:boolean,confidence=0.7){words=on?{confidence}:undefined;}
export const wordsConfidence=()=>words?.confidence;
/** How much surer one offer must be to take the place of the one on screen. */
export const MARGIN=0.1,SURE=0.8;
/** Whether a move this sure should take the place of the ghost words showing. */
export const moveBeatsWords=(confidence:number)=>!!words&&confidence>=SURE&&confidence>=words.confidence+MARGIN;
let yielder:(()=>void)|undefined,offerer:((el:Element,text:string,confidence:number,why?:string)=>boolean)|undefined;
/** tab.ts: how to put its ghost away for a surer move, and how to show a move's words as its own. */
export function wordsYield(put:()=>void,offer:(el:Element,text:string,confidence:number,why?:string)=>boolean){yielder=put;offerer=offer;}
export function yieldWords(){yielder?.();}
/** A move that types into the field the user is in, offered as ghost words there. False when it could not be. */
export const offerWords=(el:Element,text:string,confidence:number,why?:string)=>offerer?.(el,text,confidence,why)??false;
