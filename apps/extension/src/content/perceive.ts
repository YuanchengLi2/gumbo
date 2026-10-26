import {roleOf,nameOf,pathOf,visible,squash,cut,parentOf} from './dom';
/** A compact model of the page for actions and the agent: the things one can act on (links, buttons, fields, menus)
 * with their role, accessible name, value, state and place, plus headings. Each gets an id that stays the same while the
 * page lives, so a step can name it; open shadow roots are included. */
export type Item={id:string;role:string;name:string;value?:string;state?:string[];rect:[number,number,number,number];path:string;nearby?:string;inView:boolean};
export type PageModel={url:string;title:string;items:Item[];headings:string[];focused?:string};

const interactive='a[href],button,input:not([type=hidden]),textarea,select,summary,[role=button],[role=link],[role=tab],[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio],[role=checkbox],[role=radio],[role=switch],[role=option],[role=combobox],[role=textbox],[role=searchbox],[role=treeitem],[contenteditable=true],[contenteditable=""],[onclick],[tabindex]:not([tabindex="-1"])';
const ids=new WeakMap<Element,string>(),byId=new Map<string,WeakRef<Element>>();let next=1;
export function idOf(el:Element){let id=ids.get(el);if(!id){id='e'+next++;ids.set(el,id);byId.set(id,new WeakRef(el));}return id;}
export function elementById(id:string):Element|null{const el=byId.get(id)?.deref();return el&&el.isConnected?el:null;}

/** Every element matching a selector, through open shadow roots. */
export function deepQuery(selector:string,root:ParentNode=document,limit=4000):Element[]{
 const out:Element[]=[],stack:ParentNode[]=[root];let seen=0;
 while(stack.length&&seen<limit){
  const scope=stack.pop()!;
  for(const el of scope.querySelectorAll('*')){seen++;if(el.matches(selector))out.push(el);if(el.shadowRoot)stack.push(el.shadowRoot);if(seen>=limit)break;}
 }
 return out;
}
export function describe(el:Element):Item{
 const rect=el.getBoundingClientRect(),state:string[]=[];
 for(const attr of ['aria-expanded','aria-checked','aria-selected','aria-pressed','aria-disabled']){const v=el.getAttribute(attr);if(v==='true')state.push(attr.slice(5));}
 if((el as HTMLInputElement).disabled)state.push('disabled');if((el as HTMLInputElement).checked)state.push('checked');
 const value=el instanceof HTMLInputElement||el instanceof HTMLTextAreaElement?el.type==='password'?undefined:cut(el.value,80):el instanceof HTMLSelectElement?el.selectedOptions[0]?.text:undefined;
 return{id:idOf(el),role:roleOf(el),name:nameOf(el,80),value,state:state.length?state:undefined,rect:[Math.round(rect.left),Math.round(rect.top),Math.round(rect.width),Math.round(rect.height)],path:pathOf(el),nearby:nearbyText(el),inView:rect.bottom>0&&rect.top<innerHeight&&rect.right>0&&rect.left<innerWidth};
}
/** A few words around an element (its row, card or list item), to tell apart buttons with the same name. */
export function nearbyText(el:Element):string|undefined{
 let node:Element|null=el.parentElement;
 for(let i=0;i<4&&node;i++,node=node.parentElement){const text=squash((node as HTMLElement).innerText??'');if(text.length>(nameOf(el).length+8))return cut(text,90);}
 return undefined;
}
export function pageModel(limit=250):PageModel{
 // What is on screen first, then the rest in page order; only the ones kept are described (the words around each cost a
 // layout read, and a big app has thousands of controls).
 const found=deepQuery(interactive).filter(el=>visible(el)).map(el=>{const r=el.getBoundingClientRect();return{el,on:r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth};});
 const items=[...found.filter(f=>f.on),...found.filter(f=>!f.on)].slice(0,limit).map(f=>describe(f.el));
 const focused=document.activeElement&&document.activeElement!==document.body?idOf(document.activeElement):undefined;
 return{url:location.href,title:document.title,items,headings:[...document.querySelectorAll('h1,h2,h3')].map(h=>squash(h.textContent??'')).filter(Boolean).slice(0,20),focused};
}
export {parentOf};
