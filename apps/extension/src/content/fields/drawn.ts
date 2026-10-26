import {clean} from '../dom';
/** Editors that draw their own caret and lay out their own lines (Monaco and its kind): the caret is the thin element
 * they draw, and the text is the lines they render, read top to bottom, with the caret's column found by measuring
 * where each character sits. */
export function containerOf(el:Element):Element{
 const known=el.closest('.monaco-editor');if(known)return known;
 let container:Element=el;for(let i=0;i<5&&container.parentElement;i++){container=container.parentElement;if(container.getBoundingClientRect().height>40)break;}
 return container;
}
export function drawnCaretRect(container:Element):{el:Element;rect:DOMRect}|null{
 const carets=[...container.querySelectorAll('[class*=cursor],[class*=caret]')].map(el=>({el,rect:el.getBoundingClientRect()})).filter(c=>c.rect.width<=4&&c.rect.height>=8&&c.rect.height<=120);
 return carets.find(c=>getComputedStyle(c.el).display!=='none')??null;
}
const lineSelector='.view-line,.ace_line,.CodeMirror-line';
/** The rendered lines and the caret's place in them, or null when the editor renders no lines in the page. */
export function drawnText(el:Element):{before:string;after:string;text:string;start:number}|null{
 const container=containerOf(el),caret=drawnCaretRect(container);if(!caret)return null;
 const lines=[...container.querySelectorAll(lineSelector)].map(line=>({line,rect:line.getBoundingClientRect(),text:clean(line.textContent??'')})).filter(l=>l.rect.height>0).sort((a,b)=>a.rect.top-b.rect.top);
 if(!lines.length)return null;
 const y=caret.rect.top+caret.rect.height/2,index=Math.max(0,lines.findIndex(l=>y>=l.rect.top&&y<l.rect.bottom));
 const column=columnAt(lines[index].line,caret.rect.left);
 const text=lines.map(l=>l.text).join('\n'),start=lines.slice(0,index).reduce((n,l)=>n+l.text.length+1,0)+column;
 return{before:text.slice(0,start),after:text.slice(start),text,start};
}
/** The character offset in a line element nearest to an x position. */
export function columnAt(line:Element,x:number):number{
 const nodes:Text[]=[];const walker=line.ownerDocument.createTreeWalker(line,NodeFilter.SHOW_TEXT);for(let n=walker.nextNode();n;n=walker.nextNode())nodes.push(n as Text);
 const total=nodes.reduce((n,t)=>n+t.data.length,0);if(!total)return 0;
 const range=line.ownerDocument.createRange();
 const edge=(offset:number)=>{let o=offset;for(const node of nodes){if(o<node.data.length){range.setStart(node,o);range.setEnd(node,o+1);const r=range.getBoundingClientRect();return r.left+r.width/2;}o-=node.data.length;}return Infinity;};
 let lo=0,hi=total;while(lo<hi){const mid=(lo+hi)>>1;if(edge(mid)<x)lo=mid+1;else hi=mid;}
 return lo;
}
