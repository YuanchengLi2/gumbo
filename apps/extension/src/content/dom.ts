/** Small DOM helpers the field engine shares: the focused element through shadow roots, visibility, roles and
 * accessible names (what a screen reader would read), and text clean-up. */
export const BLOCK=new Set(['ADDRESS','ARTICLE','ASIDE','BLOCKQUOTE','DD','DIV','DL','DT','FIELDSET','FIGCAPTION','FIGURE','FOOTER','FORM','H1','H2','H3','H4','H5','H6','HEADER','HR','LI','MAIN','NAV','OL','P','PRE','SECTION','TABLE','TBODY','THEAD','TR','TD','TH','UL','DETAILS','SUMMARY']);
/** What is not the page's content: its menus, banner and footer, side bars, fields being written in, and Gumbo's own
 * layer. */
export const SKIP='nav,header,footer,aside,[role=navigation],[role=banner],[role=contentinfo],[contenteditable=true],[contenteditable=""],textarea,gumbo-layer';
/** Zero-width characters editors keep in their text (Draft, Slate, Lexical) that mean nothing to a reader. */
export const INVISIBLE=/[​‌‍﻿]/g;
export const clean=(text:string)=>text.replace(INVISIBLE,'').replace(/ /g,' ');
export const squash=(text:string)=>clean(text).replace(/\s+/g,' ').trim();

/** The element that really has focus, inside open shadow roots and same-document frames' hosts. */
export function deepActive(doc:Document=document):Element|null{
 let active:Element|null=doc.activeElement;
 while(active?.shadowRoot?.activeElement)active=active.shadowRoot.activeElement;
 return active;
}
export function visible(el:Element){
 const rect=el.getBoundingClientRect();if(rect.width<1||rect.height<1)return false;
 const style=getComputedStyle(el);return style.visibility!=='hidden'&&style.display!=='none'&&Number(style.opacity)>0.05;
}
/** The ancestor, crossing shadow roots. */
export function parentOf(node:Node):Node|null{return node.parentNode instanceof ShadowRoot?node.parentNode.host:node.parentNode;}
export function closestDeep(el:Element,selector:string):Element|null{
 for(let node:Node|null=el;node;node=parentOf(node))if(node instanceof Element&&node.matches(selector))return node;
 return null;
}

const implicitRoles:Record<string,string>={A:'link',BUTTON:'button',TEXTAREA:'textbox',SELECT:'combobox',H1:'heading',H2:'heading',H3:'heading',H4:'heading',H5:'heading',H6:'heading',NAV:'navigation',MAIN:'main',FORM:'form',DIALOG:'dialog',UL:'list',OL:'list',LI:'listitem',IMG:'img',ARTICLE:'article',SUMMARY:'button',OPTION:'option',TABLE:'table',HEADER:'banner',FOOTER:'contentinfo',ASIDE:'complementary',SECTION:'region'};
export function roleOf(el:Element):string{
 const explicit=el.getAttribute('role')?.split(/\s+/)[0];if(explicit)return explicit;
 if(el instanceof HTMLInputElement){const type=el.type;return type==='checkbox'?'checkbox':type==='radio'?'radio':type==='submit'||type==='button'||type==='reset'||type==='image'?'button':type==='range'?'slider':type==='search'?'searchbox':'textbox';}
 if(el.tagName==='A'&&!el.hasAttribute('href'))return 'generic';
 if((el as HTMLElement).isContentEditable&&!(el.parentElement?.isContentEditable))return 'textbox';
 return implicitRoles[el.tagName]??'generic';
}
/** The accessible name, roughly as Chrome computes it: aria-labelledby, aria-label, a label, alt or title, then text. */
export function nameOf(el:Element,max=120):string{
 const doc=el.ownerDocument,by=el.getAttribute('aria-labelledby');
 if(by){const text=by.split(/\s+/).map(id=>doc.getElementById(id)?.textContent??'').join(' ');if(squash(text))return cut(squash(text),max);}
 const aria=el.getAttribute('aria-label');if(aria&&squash(aria))return cut(squash(aria),max);
 if(el instanceof HTMLInputElement||el instanceof HTMLTextAreaElement||el instanceof HTMLSelectElement){
  const labels=el.labels?[...el.labels].map(l=>l.textContent??'').join(' '):'';if(squash(labels))return cut(squash(labels),max);
  if(el instanceof HTMLInputElement&&['submit','button','reset'].includes(el.type)&&el.value)return cut(el.value,max);
 }
 const alt=el.getAttribute('alt')??el.getAttribute('title');if(alt&&squash(alt))return cut(squash(alt),max);
 // A field is named by its placeholder, never by what was typed in it; a custom combobox shows its value as text.
 if(['textbox','searchbox','combobox'].includes(roleOf(el))){
  const placeholder=squash(el.getAttribute('placeholder')??el.getAttribute('aria-placeholder')??el.getAttribute('data-placeholder')??'');
  if(placeholder||el instanceof HTMLInputElement||el instanceof HTMLTextAreaElement||(el as HTMLElement).isContentEditable)return cut(placeholder,max);
 }
 return cut(squash((el as HTMLElement).innerText??el.textContent??''),max);
}
export const cut=(text:string,max:number)=>text.length>max?text.slice(0,max-1).trimEnd()+'…':text;
/** A short CSS path to find the element again (ids where stable, else tag and position). */
export function pathOf(el:Element):string{
 const parts:string[]=[];
 for(let node:Element|null=el;node&&node.nodeType===1&&parts.length<8;node=node.parentElement){
  if(node.id&&/^[A-Za-z][\w-]{1,40}$/.test(node.id)&&!/\d{3,}/.test(node.id)){parts.unshift('#'+CSS.escape(node.id));break;}
  const siblings=node.parentElement?[...node.parentElement.children].filter(c=>c.tagName===node!.tagName):[];
  parts.unshift(node.tagName.toLowerCase()+(siblings.length>1?`:nth-of-type(${siblings.indexOf(node)+1})`:''));
 }
 return parts.join(' > ');
}
