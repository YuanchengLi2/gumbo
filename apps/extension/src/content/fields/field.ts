import {closestDeep,nameOf} from '../dom';
/** A field Gumbo can work in: a text input, a textarea or an editing host (contenteditable), with the editor library
 * that drives it, since insertion and the caret depend on it. Sensitive fields (passwords, cards, codes, IDs) and
 * fields inside payment frames are never fields. */
export type Editor='input'|'textarea'|'contenteditable'|'prosemirror'|'lexical'|'slate'|'draft'|'quill'|'ckeditor'|'tinymce'|'codemirror'|'monaco'|'editcontext'|'gdocs';
/** kind: 'text' (input, textarea), 'editable' (contenteditable), or 'context': an element driven by Chrome's EditContext
 * API (Monaco, and editors that draw their own text), whose text and selection the EditContext holds. */
export type Field={el:HTMLElement;kind:'text'|'editable'|'context';editor:Editor;singleLine:boolean};
/** The EditContext an element is driven by, if any. */
export const editContextOf=(el:Element):any=>(el as any).editContext??null;

const textTypes=new Set(['text','search','email','url','']);
const sensitiveWords=/pass(word|phrase|code)?\b|passwd|\bpin\b|cvv|cvc|csc|security code|card ?(number|no)|cc-?(num|number|exp|csc)|expir|ssn|social security|\biban\b|routing|account (number|no)|\botp\b|one[- ]time|verification code|auth(entication)? code|2fa|mfa|tax ?id|passport|driver'?s? licen[cs]e|secret|api[ _-]?key|token/i;
const sensitiveAutocomplete=/cc-|one-time-code|current-password|new-password|transaction-amount/;
/** Frames run by payment providers: their fields are never touched. */
const paymentHosts=/(^|\.)(stripe\.com|stripe\.network|braintreegateway\.com|braintree-api\.com|paypal\.com|paypalobjects\.com|adyen\.com|checkout\.com|squareup\.com|squarecdn\.com|klarna\.com|affirm\.com|recurly\.com|chargebee\.com|authorize\.net|worldpay\.com)$/;

export function inPaymentFrame(win:Window=window){try{return paymentHosts.test(win.location.hostname);}catch{return true;}}

/** The field an event target or focused element belongs to, if Gumbo may work in it. */
export function fieldOf(target:EventTarget|null):Field|null{
 if(!(target instanceof Element))return null;
 if(inPaymentFrame(target.ownerDocument.defaultView??window))return null;
 if(target instanceof HTMLInputElement){
  if(!textTypes.has(target.type)||target.readOnly||target.disabled||sensitive(target))return null;
  return{el:target,kind:'text',editor:'input',singleLine:true};
 }
 if(target instanceof HTMLTextAreaElement){
  if(target.readOnly||target.disabled||sensitive(target))return null;
  const monaco=target.closest('.monaco-editor');
  return{el:target,kind:'text',editor:monaco?'monaco':'textarea',singleLine:false};
 }
 const el=target as HTMLElement;
 if(editContextOf(el)){
  if(sensitive(el))return null;
  return{el,kind:'context',editor:el.closest('.monaco-editor')?'monaco':'editcontext',singleLine:false};
 }
 if(!el.isContentEditable)return null;
 const host=editingHost(el);if(!host||sensitive(host))return null;
 if(host.getAttribute('aria-readonly')==='true'||host.getAttribute('aria-disabled')==='true')return null;
 const editor=editorOf(host);
 const singleLine=host.getAttribute('aria-multiline')==='false'||(host.getAttribute('role')==='textbox'&&host.getAttribute('aria-multiline')!=='true'&&host.getBoundingClientRect().height<40&&editor==='contenteditable');
 return{el:host,kind:'editable',editor,singleLine};
}
/** The outermost element of an editable region. */
export function editingHost(el:HTMLElement):HTMLElement|null{
 let host:HTMLElement|null=el.isContentEditable?el:null;
 while(host?.parentElement?.isContentEditable)host=host.parentElement;
 return host;
}
export function editorOf(host:HTMLElement):Editor{
 if(host.classList.contains('ProseMirror'))return 'prosemirror';
 if(host.getAttribute('data-lexical-editor')==='true')return 'lexical';
 if(host.getAttribute('data-slate-editor')==='true')return 'slate';
 if(host.classList.contains('public-DraftEditor-content')||host.closest('.DraftEditor-root'))return 'draft';
 if(host.classList.contains('ql-editor'))return 'quill';
 if(host.classList.contains('ck-editor__editable')||host.classList.contains('ck-content'))return 'ckeditor';
 if(host.id==='tinymce'||host.classList.contains('mce-content-body'))return 'tinymce';
 if(host.classList.contains('cm-content'))return 'codemirror';
 if(host.ownerDocument.defaultView?.frameElement?.classList.contains('docs-texteventtarget-iframe'))return 'gdocs';
 return 'contenteditable';
}
/** Passwords, card and bank numbers, one-time codes, IDs: by type, autocomplete, and the words naming the field. */
export function sensitive(el:HTMLElement):boolean{
 if(el instanceof HTMLInputElement){
  if(el.type==='password'||el.type==='hidden')return true;
  // Short numeric boxes are verification codes and PINs.
  if((el.inputMode==='numeric'||el.type==='tel'||el.pattern==='[0-9]*')&&el.maxLength>0&&el.maxLength<=8)return true;
 }
 const auto=el.getAttribute('autocomplete')??'';if(sensitiveAutocomplete.test(auto))return true;
 const words=[el.getAttribute('name'),el.id,el.getAttribute('placeholder'),el.getAttribute('aria-label'),el.getAttribute('data-testid'),nameOf(el,80)].filter(Boolean).join(' ');
 if(sensitiveWords.test(words))return true;
 // A field inside a form that asks for a card or a password next to it is part of a payment or login step.
 return !!closestDeep(el,'form')&&!!el.closest('form')?.querySelector('input[type=password],input[autocomplete^=cc-]');
}
