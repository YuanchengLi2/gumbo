import {BLOCK,INVISIBLE,clean} from '../dom';
import {editContextOf,type Field} from './field';
import {drawnText} from './drawn';
/** The text of a field around the caret, as a reader sees it: paragraphs and line breaks as newlines, the zero-width
 * characters editors keep removed. For an editing host, a map from the text back to its nodes lets the caret's place
 * (any container and offset the selection reports) be found in the text. */
export type Snapshot={before:string;after:string;selected:string;start:number;end:number;text:string;range?:Range};

export function snapshot(field:Field,maxBefore=4000,maxAfter=1000):Snapshot|null{
 if(field.el instanceof HTMLInputElement||field.el instanceof HTMLTextAreaElement){
  const el=field.el,value=el.value.replace(/\r\n/g,'\n'),start=el.selectionStart??value.length,end=el.selectionEnd??start;
  return{before:value.slice(Math.max(0,start-maxBefore),start),after:value.slice(end,end+maxAfter),selected:value.slice(start,end),start,end,text:value};
 }
 if(field.kind==='context'){
  // What the editor shows is the truth: its rendered lines when it draws them in the page. Otherwise the EditContext,
  // which holds the editor's text near the caret and the selection in it.
  const drawn=drawnText(field.el);
  if(drawn)return{before:drawn.before.slice(-maxBefore),after:drawn.after.slice(0,maxAfter),selected:'',start:drawn.start,end:drawn.start,text:drawn.text};
  const context=editContextOf(field.el);if(!context)return null;
  const value=String(context.text??''),start=context.selectionStart??value.length,end=context.selectionEnd??start;
  return{before:value.slice(Math.max(0,start-maxBefore),start),after:value.slice(end,end+maxAfter),selected:value.slice(start,end),start,end,text:value};
 }
 const selection=selectionIn(field.el);if(!selection)return null;
 const range=selection.getRangeAt(0),map=textMap(field.el);
 const start=indexOf(map,range,true),end=range.collapsed?start:indexOf(map,range,false);
 return{before:map.text.slice(Math.max(0,start-maxBefore),start),after:map.text.slice(end,end+maxAfter),selected:map.text.slice(start,end),start,end,text:map.text,range:range.cloneRange()};
}
/** The document's selection when it is inside this element (open shadow roots included). */
export function selectionIn(host:HTMLElement):Selection|null{
 const root=host.getRootNode() as Document|ShadowRoot;
 const selection=(root as any).getSelection?.()??host.ownerDocument.getSelection();
 if(!selection||!selection.rangeCount)return null;
 const range=selection.getRangeAt(0);
 return host.contains(range.startContainer)?selection:null;
}

const ZERO_WIDTH=/[\u200B\u200C\u200D\uFEFF]/;
type Entry={node:Node;start:number;block:Element;newlineBefore:boolean};
export type TextMap={text:string;entries:Entry[];host:HTMLElement};
const blockOf=(node:Node,host:Element):Element=>{for(let el=node.nodeType===1?node as Element:node.parentElement;el&&el!==host;el=el.parentElement)if(BLOCK.has(el.tagName))return el;return host;};

export function textMap(host:HTMLElement):TextMap{
 const walker=host.ownerDocument.createTreeWalker(host,NodeFilter.SHOW_TEXT|NodeFilter.SHOW_ELEMENT,{acceptNode:node=>{
  if(node.nodeType===1){const el=node as Element;if(el.tagName==='BR')return NodeFilter.FILTER_ACCEPT;
   // Hidden parts and the editor's own decorations (placeholders drawn as elements) are not text.
   if(el.getAttribute('aria-hidden')==='true'&&!el.querySelector('[contenteditable=true]'))return NodeFilter.FILTER_REJECT;
   if(el.tagName==='STYLE'||el.tagName==='SCRIPT'||el.tagName==='TEMPLATE')return NodeFilter.FILTER_REJECT;
   return NodeFilter.FILTER_SKIP;}
  return NodeFilter.FILTER_ACCEPT;}});
 const entries:Entry[]=[];let text='',lastBlock:Element|null=null;
 for(let node=walker.nextNode();node;node=walker.nextNode()){
  const block=blockOf(node,host);let newlineBefore=false;
  if(lastBlock&&block!==lastBlock&&!text.endsWith('\n')){text+='\n';newlineBefore=true;}
  lastBlock=block;
  if(node.nodeType===1){
   // A <br> ends a line, except the one that only keeps an empty block open.
   const br=node as Element,last=br===br.parentElement?.lastChild&&BLOCK.has(br.parentElement.tagName);
   entries.push({node,start:text.length,block,newlineBefore});if(!last)text+='\n';continue;
  }
  entries.push({node,start:text.length,block,newlineBefore});text+=clean((node as Text).data);
 }
 return{text,entries,host};
}
/** Where a range boundary falls in the text map. */
export function indexOf(map:TextMap,range:Range,start=true):number{
 const container=start?range.startContainer:range.endContainer,offset=start?range.startOffset:range.endOffset;
 if(container.nodeType===3){
  const entry=map.entries.find(e=>e.node===container);
  if(entry)return entry.start+(container as Text).data.slice(0,offset).replace(INVISIBLE,'').length;
 }
 // An element boundary: the first piece of text at or after it.
 const point=container.ownerDocument!.createRange();point.setStart(container,offset);point.collapse(true);
 let lo=0,hi=map.entries.length;
 while(lo<hi){const mid=(lo+hi)>>1;if(point.comparePoint(map.entries[mid].node,0)>=0)hi=mid;else lo=mid+1;}
 if(lo>=map.entries.length)return map.text.length;
 const entry=map.entries[lo],caretBlock=blockOf(container.nodeType===1&&offset<container.childNodes.length?container.childNodes[offset]:container,map.host);
 // At the end of one paragraph, the caret sits before the newline that starts the next.
 return entry.newlineBefore&&entry.block!==caretBlock?entry.start-1:entry.start;
}
/** A DOM range for a span of the text map (to select what Ctrl+K replaces, or to measure a character). */
export function rangeOf(map:TextMap,from:number,to:number):Range|null{
 const point=(index:number):[Node,number]|null=>{
  for(let i=map.entries.length-1;i>=0;i--){
   const e=map.entries[i];if(e.start>index)continue;
   if(e.node.nodeType===3){const data=(e.node as Text).data;let kept=0,raw=0;while(raw<data.length&&kept<index-e.start){if(!ZERO_WIDTH.test(data[raw]))kept++;raw++;}return[e.node,raw];}
   const parent=e.node.parentNode!;return[parent,[...parent.childNodes].indexOf(e.node as ChildNode)+(index>e.start?1:0)];
  }
  return map.entries.length?[map.entries[0].node,0]:[map.host,0];
 };
 const a=point(from),b=point(to);if(!a||!b)return null;
 const range=map.host.ownerDocument.createRange();range.setStart(a[0],a[1]);range.setEnd(b[0],b[1]);return range;
}
