import {TAKE_KEY} from '../keys';
import {surface,raise} from './root';
import type {Caret} from '../fields/caret';
/** Ghost text: the suggestion drawn exactly where typing it would put it. It starts at the caret in the field's own
 * font and size and wraps at the same edges as the field's text (the first line indented to the caret), so accepting
 * it changes nothing on screen but the colour. Lines after the first are drawn over the field's own background, since
 * a page cannot move its text down to make room. Where the caret is mid-line, or the text would run past the field,
 * it shows as a chip under the caret instead. */
let ghost:HTMLDivElement|undefined,chip:HTMLDivElement|undefined;

export type Shown={mode:'inline'|'chip';rect:DOMRect};
export function showGhost(caret:Caret,text:string,{atLineEnd,singleLine,ownWrapping=false}:{atLineEnd:boolean;singleLine:boolean;ownWrapping?:boolean}):Shown{
 hideGhost();raise();
 // Editors that wrap lines by their own rule (Monaco and its kind) get a one-line ghost, and the chip when it would wrap.
 if(ownWrapping&&atLineEnd&&!text.includes('\n')){
  const el=inline(caret,text,true),rect=el.getBoundingClientRect(),words=el.firstElementChild!.getBoundingClientRect();
  if(words.right<=caret.right+1)return{mode:'inline',rect};
  el.remove();ghost=undefined;
 }
 else if(atLineEnd&&!(singleLine&&text.includes('\n'))){
  const el=inline(caret,text,singleLine);
  // Too tall for what is left of the field (or the window): a chip is better than text running off.
  const rect=el.getBoundingClientRect();
  if(rect.bottom<=Math.min(window.innerHeight,caret.bottom+caret.height*2.2)+1||singleLine)return{mode:'inline',rect};
  el.remove();ghost=undefined;
 }
 const box=chipAt(caret,text);return{mode:'chip',rect:box.getBoundingClientRect()};
}
function inline(caret:Caret,text:string,singleLine:boolean){const el=ghostAt(caret,text,singleLine);ghost=el;return el;}
/** Ghost text at a caret, on its own (not the text suggestion): Tab for actions shows what it would type this way. */
export function ghostAt(caret:Caret,text:string,singleLine:boolean){
 const el=document.createElement('div');el.className='ghost';
 const s=caret.scale,rtl=caret.direction==='rtl',width=(caret.right-caret.left)/s;
 const indent=(rtl?caret.right-caret.x:caret.x-caret.left)/s;
 Object.assign(el.style,{
  left:`${caret.left}px`,top:`${caret.top}px`,width:`${width}px`,textIndent:`${indent}px`,direction:caret.direction,textAlign:rtl?'right':'left',
  fontFamily:caret.font.family,fontSize:caret.font.size,fontWeight:caret.font.weight,fontStyle:caret.font.style,letterSpacing:caret.font.letterSpacing,wordSpacing:caret.font.wordSpacing,
  lineHeight:`${caret.height/s}px`,textTransform:caret.font.textTransform,tabSize:caret.font.tabSize,color:`color-mix(in srgb, ${caret.font.color} 42%, transparent)`,transform:s!==1?`scale(${s})`:'',
  whiteSpace:singleLine?'pre':'pre-wrap',overflow:singleLine?'hidden':'visible',
 });
 if(singleLine){el.style.textIndent='0';el.style.left=`${caret.x}px`;el.style.width=`${Math.max(0,(caret.right-caret.x)/s)}px`;}
 // Continuation lines cover what is below them with the field's own background (the first line ends where text ends).
 const first=document.createElement('span');first.textContent=text;
 if(!singleLine){first.style.background=caret.background;first.style.boxDecorationBreak='clone';first.style.setProperty('-webkit-box-decoration-break','clone');}
 el.appendChild(first);surface().appendChild(el);return el;
}
function chipAt(caret:Caret,text:string){
 const box=document.createElement('div');box.className='chip';box.setAttribute('role','status');
 const words=document.createElement('span');words.className='text';words.textContent=text.trim();
 const key=document.createElement('kbd');key.textContent=TAKE_KEY;
 box.append(words,key);surface().appendChild(box);
 const rect=box.getBoundingClientRect(),below=caret.top+caret.height+6;
 const top=below+rect.height>window.innerHeight-4?caret.top-rect.height-6:below;
 box.style.left=`${Math.max(4,Math.min(caret.x-10,window.innerWidth-rect.width-8))}px`;box.style.top=`${Math.max(4,top)}px`;
 chip=box;return box;
}
/** Where a fact in the suggestion came from ("from Calendar: dentist · Oct 20"), small, under the caret's line, so a
 * wrong fact is easy to see before it is taken. */
let hint:HTMLDivElement|undefined;
export function showHint(caret:Caret,text:string){
 hint?.remove();const el=document.createElement('div');el.className='hint';el.textContent=text;surface().appendChild(el);
 const r=el.getBoundingClientRect(),below=caret.top+caret.height+3;
 el.style.left=`${Math.max(4,Math.min(caret.x,window.innerWidth-r.width-8))}px`;el.style.top=`${below+r.height>window.innerHeight-4?caret.top-r.height-3:below}px`;
 hint=el;
}
export function hideGhost(){ghost?.remove();chip?.remove();hint?.remove();ghost=chip=hint=undefined;}
export const ghostShown=()=>!!(ghost||chip);
