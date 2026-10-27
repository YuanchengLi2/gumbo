import {roleOf,nameOf,pathOf,visible,squash,cut,parentOf} from './dom';
/** A compact model of the page for actions and the agent: the things one can act on (links, buttons, fields, menus)
 * with their role, accessible name, value, state and place, plus headings. Each gets an id that stays the same while the
 * page lives, so a step can name it; open shadow roots are included. */
export type Item={id:string;role:string;name:string;value?:string;state?:string[];rect:[number,number,number,number];path:string;nearby?:string;inView:boolean};
export type PageModel={url:string;title:string;items:Item[];headings:string[];focused?:string};

// What a hand can act on: controls, things to drag (natively, or marked as sortable by the libraries that do it with the
// mouse), and headings (renamed by double-click, opened by click in many apps).
const interactive='a[href],button,input:not([type=hidden]),textarea,select,summary,[role=button],[role=link],[role=tab],[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio],[role=checkbox],[role=radio],[role=switch],[role=option],[role=combobox],[role=textbox],[role=searchbox],[role=treeitem],[role=slider],[contenteditable=true],[contenteditable=""],[onclick],[tabindex]:not([tabindex="-1"]),[draggable=true],[aria-roledescription],h1,h2,h3';
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
/** within: only what is inside this element (where the user is working: a form, a dialog, a menu). */
export function pageModel(limit=250,within:ParentNode=document):PageModel{
 // What is on screen first, then the rest in page order; only the ones kept are described (the words around each cost a
 // layout read, and a big app has thousands of controls).
 const els=deepQuery(interactive,within).filter(el=>visible(el));
 // Where things can be dropped: when the page has things to drag, the lists or columns that hold them, and the ones
 // beside those (a board's other columns).
 const zones=new Set<Element>(),have=new Set(els);
 for(const d of els.filter(el=>el.matches('[draggable=true],[aria-roledescription]')).slice(0,60)){
  const holder=d.parentElement;if(!holder||holder===document.body)continue;zones.add(holder);
  for(const sibling of holder.parentElement?.children??[])if(sibling!==holder&&sibling.children.length<300&&visible(sibling))zones.add(sibling);
 }
 for(const z of zones)if(!have.has(z))els.push(z);
 const found=els.map(el=>{const r=el.getBoundingClientRect();return{el,on:r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth};});
 const items=[...found.filter(f=>f.on),...found.filter(f=>!f.on)].slice(0,limit).map(f=>describe(f.el));
 // Menus that open on hover by CSS alone (no event a page script sends opens them): their items are in the page, hidden,
 // and listed with the menu they are in, so a move can go straight to one.
 for(const {el,owner} of hoverMenuItems(Math.max(0,Math.min(40,limit-items.length))).filter(h=>within===document||(within as Element).contains(h.el))){
  const item=describe(el),trigger=describe(owner);
  items.push({...item,rect:trigger.rect,inView:trigger.inView,state:[...(item.state??[]),`in the “${cut(trigger.name,40)}” menu, shown on hover`]});
 }
 const focused=document.activeElement&&document.activeElement!==document.body?idOf(document.activeElement):undefined;
 return{url:location.href,title:document.title,items,headings:[...document.querySelectorAll('h1,h2,h3')].map(h=>squash(h.textContent??'')).filter(Boolean).slice(0,20),focused};
}
/** The hidden items of navigation menus that open on hover: links and menu items in a nav, header or menu bar that are
 * not shown while the item of the menu that holds them is (its trigger: what the pointer rests on to open it). */
function hoverMenuItems(limit:number):{el:Element;owner:Element}[]{
 const out:{el:Element;owner:Element}[]=[];if(!limit)return out;
 for(const el of deepQuery('nav a[href],header a[href],[role=menubar] a[href],nav [role=menuitem],header [role=menuitem],[role=menubar] [role=menuitem]')){
  if(out.length>=limit)break;
  if(visible(el))continue;
  const owner=hoverOwner(el);if(owner)out.push({el,owner});
 }
 return out;
}
/** What opens the hover menu an element is hidden in: the first shown control of the list item that holds its menu. */
export function hoverOwner(el:Element):Element|null{
 const menu=el.closest('ul,ol,[role=menu]'),holder=menu?.parentElement?.closest('li,[role=none],[role=menuitem]');
 if(!holder||!visible(holder))return null;
 const trigger=[...holder.querySelectorAll(':scope > a,:scope > button,:scope > [role=menuitem],:scope > span,:scope > div > a,:scope > div > button')].find(t=>visible(t)&&!t.contains(el));
 return trigger??null;
}
export {parentOf};
