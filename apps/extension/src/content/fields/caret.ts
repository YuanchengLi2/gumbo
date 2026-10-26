import type {Field} from './field';
import {selectionIn} from './text';
import {containerOf,drawnCaretRect} from './drawn';
/** Where the caret is on screen, and what the text there looks like, so ghost text can be drawn exactly where typed
 * text would appear: in the same font, starting at the caret and wrapping at the same edges.
 * - input and textarea: a mirror of the field (same box and font) in Gumbo's own shadow root measures the caret;
 * - an editing host: the caret's rectangle from the selection, or from the character beside it when the caret has none
 *   (an empty line), and the paragraph it is in gives the edges. */
export type Caret={
 /** The caret's left (right, in right-to-left text), top and line height, in viewport pixels. */
 x:number;top:number;height:number;
 /** The edges text wraps at on this line's block, in viewport pixels. */
 left:number;right:number;
 /** The bottom of the field's visible box: ghost text may not run past it. */
 bottom:number;
 font:{family:string;size:string;weight:string;style:string;letterSpacing:string;wordSpacing:string;lineHeight:string;textTransform:string;color:string;tabSize:string};
 direction:'ltr'|'rtl';
 /** The field's scale on screen (CSS transforms, zoom), for drawing text at the same size. */
 scale:number;
 /** The background behind the text, to draw ghost lines over what follows. */
 background:string;
 whiteSpace:string;
};
const mirrorProps=['direction','boxSizing','width','height','overflowX','overflowY','borderTopWidth','borderRightWidth','borderBottomWidth','borderLeftWidth','borderStyle','paddingTop','paddingRight','paddingBottom','paddingLeft','fontStyle','fontVariant','fontWeight','fontStretch','fontSize','fontSizeAdjust','lineHeight','fontFamily','fontFeatureSettings','fontKerning','textAlign','textTransform','textIndent','letterSpacing','wordSpacing','tabSize','whiteSpace','wordWrap','wordBreak','overflowWrap','textRendering'] as const;
let mirrorHost:ShadowRoot|undefined;
/** Where mirrors are measured: a shadow root of Gumbo's own, so measuring never touches the page's DOM. */
export function useMirrorRoot(root:ShadowRoot){mirrorHost=root;}

export function caretOf(field:Field):Caret|null{
 return field.kind==='text'?textFieldCaret(field.el as HTMLInputElement|HTMLTextAreaElement):field.kind==='context'?drawnCaret(field):editableCaret(field);
}
/** Editors that draw their own caret (EditContext editors such as Monaco): the caret is the thin element they draw, and
 * the line under it gives the font and the edges. */
function drawnCaret(field:Field):Caret|null{
 const container=containerOf(field.el),caret=drawnCaretRect(container);if(!caret)return null;
 const {rect}=caret,y=rect.top+rect.height/2;
 const line=document.elementsFromPoint(Math.max(0,rect.left-2),y).find(el=>container.contains(el)&&el!==caret.el&&!!el.textContent?.trim())??field.el;
 const style=getComputedStyle(line),box=(line.closest('.view-line')??line).getBoundingClientRect(),area=container.getBoundingClientRect();
 return{x:rect.left,top:rect.top,height:rect.height,left:box.left,right:Math.min(area.right,Math.max(box.right,area.right-20)),bottom:area.bottom,font:fontOf(style),direction:style.direction==='rtl'?'rtl':'ltr',scale:1,background:backgroundOf(line),whiteSpace:'pre-wrap'};
}

function fontOf(style:CSSStyleDeclaration):Caret['font']{return{family:style.fontFamily,size:style.fontSize,weight:style.fontWeight,style:style.fontStyle,letterSpacing:style.letterSpacing,wordSpacing:style.wordSpacing,lineHeight:style.lineHeight,textTransform:style.textTransform,color:style.color,tabSize:style.tabSize};}
const px=(value:string)=>parseFloat(value)||0;
function lineHeightOf(style:CSSStyleDeclaration){const lh=px(style.lineHeight);return lh>0?lh:px(style.fontSize)*1.2;}
/** The first background colour that is not transparent, walking up. */
export function backgroundOf(el:Element|null):string{
 for(let node=el;node;node=node.parentElement){const bg=getComputedStyle(node).backgroundColor;if(bg&&!/rgba\(.*,\s*0\)$|transparent/.test(bg))return bg;}
 return 'rgb(255, 255, 255)';
}

function textFieldCaret(el:HTMLInputElement|HTMLTextAreaElement):Caret|null{
 if(!mirrorHost)return null;
 const style=getComputedStyle(el),rect=el.getBoundingClientRect(),scale=el.offsetWidth?rect.width/el.offsetWidth:1;
 const mirror=document.createElement('div'),input=el instanceof HTMLInputElement;
 for(const prop of mirrorProps)(mirror.style as any)[prop]=(style as any)[prop];
 Object.assign(mirror.style,{position:'absolute',visibility:'hidden',top:'0',left:'-10000px',overflowX:'hidden',overflowY:!input&&el.scrollHeight>el.clientHeight?'scroll':'hidden',whiteSpace:input?'pre':'pre-wrap',wordWrap:input?'normal':'break-word',height:'auto'});
 const position=el.selectionEnd??el.value.length,value=el.value.replace(/\r\n/g,'\n');
 // A zero-width inline block at the caret: its box is the line box, whatever the line height, and it wraps nothing.
 const marker=document.createElement('span');marker.style.cssText='display:inline-block;width:0;overflow:hidden';marker.textContent='\u200b';
 mirror.append(value.slice(0,position),marker,value.slice(position)||' ');
 mirrorHost.appendChild(mirror);
 const lineHeight=marker.offsetHeight||lineHeightOf(style),markerTop=marker.offsetTop+px(style.borderTopWidth),markerLeft=marker.offsetLeft+px(style.borderLeftWidth);
 mirror.remove();
 const left=rect.left+(px(style.borderLeftWidth)+px(style.paddingLeft))*scale,right=rect.right-(px(style.borderRightWidth)+px(style.paddingRight))*scale;
 const contentTop=rect.top+(px(style.borderTopWidth)+px(style.paddingTop))*scale,contentBottom=rect.bottom-(px(style.borderBottomWidth)+px(style.paddingBottom))*scale;
 // An input's single line sits in the middle of its content box.
 const top=input?contentTop+(contentBottom-contentTop-lineHeight*scale)/2:rect.top+(markerTop-el.scrollTop)*scale;
 return{x:rect.left+(markerLeft-el.scrollLeft)*scale,top,height:lineHeight*scale,left,right,bottom:contentBottom,font:fontOf(style),direction:style.direction==='rtl'?'rtl':'ltr',scale,background:backgroundOf(el),whiteSpace:input?'pre':'pre-wrap'};
}

function editableCaret(field:Field):Caret|null{
 const selection=selectionIn(field.el);if(!selection)return null;
 const range=selection.getRangeAt(0).cloneRange();range.collapse(false);
 const node=range.startContainer,element=(node.nodeType===1?node:node.parentElement) as Element|null;if(!element)return null;
 const style=getComputedStyle(element),lineHeight=lineHeightOf(style);
 let rect=lastRect(range);
 if(!rect&&node.nodeType===3){
  // A collapsed range in text usually has a rectangle; when it does not, measure the character before or after it.
  const text=node as Text,beside=node.ownerDocument!.createRange();
  if(range.startOffset>0){beside.setStart(text,range.startOffset-1);beside.setEnd(text,range.startOffset);const r=lastRect(beside);if(r)rect=new DOMRect(style.direction==='rtl'?r.left:r.right,r.top,0,r.height);}
  else if(text.length){beside.setStart(text,0);beside.setEnd(text,1);const r=lastRect(beside);if(r)rect=new DOMRect(style.direction==='rtl'?r.right:r.left,r.top,0,r.height);}
 }
 const block=blockElement(element,field.el),blockStyle=getComputedStyle(block),blockRect=block.getBoundingClientRect();
 const scale=(field.el.offsetWidth?field.el.getBoundingClientRect().width/field.el.offsetWidth:1)||1;
 const left=blockRect.left+(px(blockStyle.borderLeftWidth)+px(blockStyle.paddingLeft))*scale,right=blockRect.right-(px(blockStyle.borderRightWidth)+px(blockStyle.paddingRight))*scale;
 if(!rect){
  // An empty line: the caret sits at the start of the block it is in (the element the selection names, or the child at its offset).
  const at=node.nodeType===1&&range.startOffset<node.childNodes.length?node.childNodes[range.startOffset]:node;
  const target=(at.nodeType===1?at:at.parentElement) as Element,box=(target.tagName==='BR'?target.parentElement!:target).getBoundingClientRect();
  rect=new DOMRect(style.direction==='rtl'?right:left,box.top+(px(getComputedStyle(target.tagName==='BR'?target.parentElement!:target).paddingTop))*scale,0,lineHeight*scale);
 }
 // The caret's rectangle is the font's box; the line box around it adds half the leading above and below. With
 // line-height normal the two are the same. A rectangle taller than the line (an image on it) keeps its bottom.
 const line=px(style.lineHeight)>0?px(style.lineHeight)*scale:rect.height||lineHeight*scale;
 const top=rect.height<=line?rect.top-(line-rect.height)/2:rect.bottom-line;
 const host=field.el.getBoundingClientRect(),hostStyle=getComputedStyle(field.el);
 return{x:rect.left,top,height:line,left,right,bottom:host.bottom-(px(hostStyle.borderBottomWidth)+px(hostStyle.paddingBottom))*scale,font:fontOf(style),direction:style.direction==='rtl'?'rtl':'ltr',scale,background:backgroundOf(block),whiteSpace:style.whiteSpace.startsWith('pre')?'pre-wrap':'pre-wrap'};
}
function lastRect(range:Range):DOMRect|null{const rects=range.getClientRects();for(let i=rects.length-1;i>=0;i--)if(rects[i].height>0)return rects[i];return null;}
function blockElement(el:Element,host:HTMLElement):Element{
 for(let node:Element|null=el;node&&node!==host;node=node.parentElement){const display=getComputedStyle(node).display;if(display==='block'||display==='list-item'||display==='flex'||display==='table-cell')return node;}
 return host;
}
