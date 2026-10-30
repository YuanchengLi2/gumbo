import {editContextOf,hiddenBox,type Field} from './field';
import {snapshot,textMap,rangeOf,selectionIn} from './text';
import {clean} from '../dom';
/** Putting text into a field so it sticks, the way typing would: the field's own undo works, and React, ProseMirror,
 * Lexical, Slate, Draft, Quill and the rest all see it. Ways are tried in order until the field reads back right:
 *  1. document.execCommand('insertText'): what the browser does for typed text, on the field's undo stack;
 *  2. for input and textarea, setRangeText and an input event (frameworks that ignored 1);
 *  3. a beforeinput event for editors that handle input themselves (Slate, Lexical);
 *  4. a paste of the text (and HTML, for rich text), which every editor handles.
 * A try that changed the field without the right result is undone before the next. */
export type Inserted={ok:boolean;method?:'insertText'|'insertHTML'|'setRangeText'|'beforeinput'|'textupdate'|'paste';reason?:string};
const norm=(text:string)=>clean(text).replace(/\s+/g,' ').trim();
/** The next frame, or a tenth of a second when none is drawn (a tab hidden mid-insert, a busy computer): reading the
 * field back never waits on painting. */
const frame=()=>new Promise<void>(resolve=>{const done=()=>{clearTimeout(late);resolve();},late=setTimeout(done,100);requestAnimationFrame(()=>setTimeout(done,0));});

/** Replaces the text from `from` to `to` (default: the selection) with `text`; `html` is offered to rich editors. */
export async function insert(field:Field,text:string,options:{from?:number;to?:number;html?:string}={}):Promise<Inserted>{
 if(hiddenBox(field))return blindInsert(field,text);
 const before=snapshot(field,1e9,1e9);if(!before)return{ok:false,reason:'no-caret'};
 const from=options.from??before.start,to=options.to??before.end;
 const expected=before.text.slice(0,from)+text+before.text.slice(to);
 // An email input has no selection to place: its value is set as typing would set it, with the event frameworks read.
 if(field.el instanceof HTMLInputElement&&field.el.selectionStart===null){
  const input=field.el;Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,expected);
  input.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:text}));input.dispatchEvent(new Event('change',{bubbles:true}));
  return input.value===expected?{ok:true,method:'setRangeText'}:{ok:false,reason:'not-set'};
 }
 const attempts:[Inserted['method'],()=>boolean|void][]=[];
 const paste=()=>{const data=new DataTransfer();data.setData('text/plain',text);if(options.html)data.setData('text/html',options.html);field.el.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true,composed:true}));};
 // Formatted text (a Ctrl+K rewrite of rich text) goes in as HTML first: a paste for editor libraries, which parse it
 // into their own model, the browser's insertHTML for a plain editable element. Plain text is the fallback.
 if(options.html&&field.kind==='editable'){
  if(field.editor==='contenteditable')attempts.push(['insertHTML',()=>select(field,from,to)&&field.el.ownerDocument.execCommand('insertHTML',false,options.html!)]);
  else attempts.push(['paste',()=>{select(field,from,to);paste();}]);
 }
 if(field.kind==='context'){
  // An EditContext editor: a paste at its own caret is one edit (one Ctrl+Z); failing that, text as the browser gives
  // typed text: the context's text updated, then textupdate. The offsets are the EditContext's own (its selection), since
  // what the editor renders may be a different window.
  attempts.push(['paste',paste]);
  attempts.push(['textupdate',()=>{const context=editContextOf(field.el),start=context.selectionStart,end=context.selectionEnd,caret=start+text.length;context.updateText(start,end,text);context.updateSelection(caret,caret);context.dispatchEvent(new (window as any).TextUpdateEvent('textupdate',{updateRangeStart:start,updateRangeEnd:end,text,selectionStart:caret,selectionEnd:caret}));}]);
 }
 else attempts.push(['insertText',()=>select(field,from,to)&&field.el.ownerDocument.execCommand('insertText',false,text)]);
 if(field.kind==='text')attempts.push(['setRangeText',()=>setRange(field.el as HTMLInputElement|HTMLTextAreaElement,text,from,to)]);
 else if(field.kind==='editable')attempts.push(['beforeinput',()=>{select(field,from,to);field.el.dispatchEvent(new InputEvent('beforeinput',{inputType:'insertText',data:text,bubbles:true,cancelable:true,composed:true}));}]);
 if(field.kind!=='context')attempts.push(['paste',()=>{select(field,from,to);paste();}]);
 for(const [method,attempt] of attempts){
  try{attempt();}catch{continue;}
  const result=await landed(field,before.text,expected,text);
  if(result==='yes')return{ok:true,method};
  // Changed, but not into what was meant: undo that try before the next one, and stop if it cannot be undone.
  if(result==='changed'){field.el.ownerDocument.execCommand('undo');await frame();if(norm(snapshot(field,1e9,1e9)?.text??'')!==norm(before.text))return{ok:false,method,reason:'changed-wrongly'};}
 }
 return{ok:false,reason:'not-inserted'};
}
/** A drawn editor's hidden typing box (Google Docs) keeps none of the words, so what it took cannot be read back: the
 * text goes in once, at its own caret (which still holds their selection), as a paste the editor takes (it says so by
 * handling the event), else as typed text. */
function blindInsert(field:Field,text:string):Inserted{
 const data=new DataTransfer();data.setData('text/plain',text);
 const event=new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true,composed:true});field.el.dispatchEvent(event);
 if(event.defaultPrevented)return{ok:true,method:'paste'};
 try{
  if(field.kind==='context'){const context=editContextOf(field.el),start=context.selectionStart,end=context.selectionEnd,caret=start+text.length;context.updateText(start,end,text);context.updateSelection(caret,caret);context.dispatchEvent(new (window as any).TextUpdateEvent('textupdate',{updateRangeStart:start,updateRangeEnd:end,text,selectionStart:caret,selectionEnd:caret}));return{ok:true,method:'textupdate'};}
  return field.el.ownerDocument.execCommand('insertText',false,text)?{ok:true,method:'insertText'}:{ok:false,reason:'not-inserted'};
 }catch{return{ok:false,reason:'not-inserted'};}
}
/** Waits a few frames for the editor to apply the change, then compares. */
async function landed(field:Field,old:string,expected:string,text:string):Promise<'yes'|'no'|'changed'>{
 for(let i=0;i<4;i++){
  await frame();
  const now=snapshot(field,1e9,1e9)?.text??'';
  if(norm(now)===norm(expected))return 'yes';
  // Some editors reshape what they are given (smart quotes, a trailing space kept as a non-breaking one): the words
  // arrived in place if the text is the old text with them added where the caret was.
  if(norm(now)!==norm(old)){const added=norm(now).length-norm(old).length;if(Math.abs(added-norm(text).length)<=2&&norm(now).includes(norm(text).slice(0,Math.max(1,norm(text).length-2))))return 'yes';if(i===3)return 'changed';}
 }
 return 'no';
}
/** Puts the selection (or caret) on a span of the field's text, focusing the field. */
export function select(field:Field,from:number,to:number):boolean{
 const el=field.el;if(el.ownerDocument.activeElement!==el&&!el.contains(el.ownerDocument.activeElement))el.focus({preventScroll:true});
 if(field.kind==='text'){try{(el as HTMLInputElement).setSelectionRange(from,to);}catch{/* an email input: no selection */}return true;}
 if(field.kind==='context'){const context=editContextOf(el);if(context.selectionStart!==from||context.selectionEnd!==to)context.updateSelection(from,to);return true;}
 const range=rangeOf(textMap(el),from,to);if(!range)return false;
 const selection=selectionIn(el)??el.ownerDocument.getSelection();if(!selection)return false;
 const current=selection.rangeCount?selection.getRangeAt(0):null;
 // Leave the selection alone when it is already there: editors re-read a selection change as a new place to work.
 if(current&&current.startContainer===range.startContainer&&current.startOffset===range.startOffset&&current.endContainer===range.endContainer&&current.endOffset===range.endOffset)return true;
 selection.removeAllRanges();selection.addRange(range);return true;
}
/** For input and textarea: the native value change plus the input event frameworks listen for (React reads the value
 * the native setter left, so its onChange fires). */
function setRange(el:HTMLInputElement|HTMLTextAreaElement,text:string,from:number,to:number){
 el.setRangeText(text,from,to,'end');
 el.dispatchEvent(new InputEvent('input',{inputType:'insertText',data:text,bubbles:true,composed:true}));
}
