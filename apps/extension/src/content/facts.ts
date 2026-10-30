import {BLOCK,SKIP,squash} from './dom';
import {fact,factsOfLines,labelOf,uniqueFacts,type Fact,type Line} from '../shared/facts';
/** A page read for memory, from its structure, in one walk: its lines of text (menus, banner, footer, side bars, fields,
 * hidden things and Gumbo's own layer left out) and the facts on it (shared/facts.ts): a data table's cells under their
 * column (or a two-column table's label and value), a definition list's terms, labelled and typed values in its lines, and
 * its links. A header or footer inside an article or section is the content's own (an invoice's number, a message's
 * sender) and is read. Never from fields, the field being written in, or what reads as a secret. */
const NOT_TEXT='script,style,noscript,template,svg,canvas,iframe,object,input,select,option,button,[hidden],[aria-hidden=true],[role=search],[role=menu],[role=menubar],[role=toolbar],[role=tablist]';
const MAX_NODES=40_000,MAX_FACTS=120,MAX_LINKS=20,MAX_ROWS=25,MAX_CELLS=60;
const CELL=new Set(['TD','TH']);
const role=(el:Element)=>el.getAttribute('role')??'';
const isHeading=(el:Element)=>/^H[1-6]$/.test(el.tagName)||el.tagName==='CAPTION'||el.tagName==='LEGEND'||role(el)==='heading';
/** The page's main content when it marks one, else its body. */
export const contentRoot=():Element|null=>document.querySelector('main,article,[role=main]')??document.body;

function skipped(el:Element,except?:Element|null){
 if(el===except||el.matches(NOT_TEXT))return true;
 if(el.matches(SKIP))return !(/^(HEADER|FOOTER)$/.test(el.tagName)&&!role(el)&&el.parentElement?.closest('article,section,main,[role=main],[role=article]'));
 // What the page hides (a closed menu, another tab's panel), where the browser can say; a box that only groups its
 // children (display: contents) has none of its own and is read.
 return BLOCK.has(el.tagName)&&typeof (el as any).checkVisibility==='function'&&(el as any).checkVisibility()===false&&getComputedStyle(el).display!=='contents';
}
const rowsOf=(t:Element)=>t.tagName==='TABLE'?[...t.querySelectorAll(':scope > tr, :scope > thead > tr, :scope > tbody > tr, :scope > tfoot > tr')]:[...t.querySelectorAll('[role=row]')];
const cellsOf=(r:Element)=>r.tagName==='TR'?[...r.querySelectorAll(':scope > th, :scope > td')]:[...r.querySelectorAll('[role=columnheader],[role=rowheader],[role=cell],[role=gridcell]')];
const textOf=(el:Element)=>squash(el.textContent??'');
const headerCell=(c:Element)=>c.tagName==='TH'||role(c)==='columnheader'||!!c.closest('thead');
/** A table that holds data, not layout: no table inside it, and most of its rows have two cells or more. */
function dataTable(t:Element){
 if(t.querySelector('table,[role=table],[role=grid]'))return false;
 const rows=rowsOf(t);if(rows.length<2&&!(rows.length===1&&cellsOf(rows[0]).length===2))return false;
 return rows.filter(r=>cellsOf(r).length>=2).length>=Math.max(1,rows.length*0.6);
}
/** A data table's facts: under a header row, each cell keyed by its column (its row's cells near it), and a row of a label
 * and one value (a total under the items) as that; with no header row, each row's first cell is the label of the rest. */
function tableFacts(t:Element,section:string):Fact[]{
 const rows=rowsOf(t),out:Fact[]=[],caption=squash(t.querySelector('caption')?.textContent??'')||section;
 const head=rows.find(r=>{const c=cellsOf(r);return c.length>=2&&c.every(headerCell);});
 const columns:string[]=[];
 if(head)for(const c of cellsOf(head)){const span=Math.max(1,+(c.getAttribute('colspan')??1)||1);for(let i=0;i<span;i++)columns.push(textOf(c));}
 let cells=0;
 for(const r of rows.filter(r=>r!==head).slice(0,MAX_ROWS)){
  const list=cellsOf(r),texts=list.map(textOf),filled=texts.filter(Boolean),near=[caption,filled.join(' · ')].filter(Boolean).join(' — ');
  const add=(f?:Fact)=>{if(f)out.push(f);};
  // Under a header row, a row that spans or skips columns to give one label and one value is a total, not an item.
  const summary=filled.length===2&&(texts.findIndex(Boolean)>0||list.length<columns.length);
  if(columns.length&&summary&&labelOf(filled[0]))add(fact(filled[0],filled[1],caption||undefined));
  else if(columns.length){
   let at=0;
   for(const [i,c] of list.entries()){const key=columns[at];at+=Math.max(1,+(c.getAttribute('colspan')??1)||1);if(key&&texts[i]&&cells++<MAX_CELLS)add(fact(key,texts[i],near));}
  }else if(filled.length>=2&&labelOf(filled[0]))add(fact(filled[0],filled.slice(1).join(' · '),caption||undefined));
 }
 return out;
}
/** A definition list's terms and what each says. */
function listFacts(dl:Element,section:string):Fact[]{
 const out:Fact[]=[];let term='';
 for(const el of dl.querySelectorAll(':scope > dt, :scope > dd, :scope > div > dt, :scope > div > dd')){
  if(el.tagName==='DT')term=textOf(el);else if(term){const f=fact(term,textOf(el),section||undefined);if(f)out.push(f);}
 }
 return out;
}
/** A link worth remembering: to another page on the web, with words of its own, and nothing in it that signs someone in. */
function linkFact(a:HTMLAnchorElement):Fact|undefined{
 const href=a.getAttribute('href')??'';if(!/^https?:/i.test(a.href||href))return;
 let url:URL;try{url=new URL(a.href||href);}catch{return;}
 if(url.origin+url.pathname===location.origin+location.pathname&&url.hash||/[?&](token|auth|code|key|sig|signature|session|otp|reset)=/i.test(url.search))return;
 const text=textOf(a);if(text.length<2||text.length>80)return;
 url.hash='';return fact(text,url.href);
}

/** Each block of text of a page by its hash (its digits as one, so a clock or "5 min ago" ticking is no change), with
 * its length. */
export function blocksOf(lines:{text:string}[]){
 const out=new Map<number,number>();
 for(const {text} of lines){if(text.length<3)continue;let h=0x811c9dc5;const s=text.toLowerCase().replace(/\d+/g,'0');for(let i=0;i<s.length;i++)h=Math.imul(h^s.charCodeAt(i),16777619);out.set(h>>>0,text.length);}
 return out;
}
/** Whether a page's content changed since it was read: two blocks are new, or one long one (a new email opened in an
 * app that never reloads, more of a feed), whatever its length did. */
export function changed(before:Map<number,number>,now:Map<number,number>){
 let fresh=0,chars=0;
 for(const [h,length] of now)if(!before.has(h)){fresh++;chars+=length;if(fresh>=2||chars>=200)return true;}
 return false;
}
/** Reads a page (or part of it): its lines of text, at most `max` characters, and when asked its facts. */
export function readPage(root:Element|null=contentRoot(),{max=200_000,facts=true,except}:{max?:number;facts?:boolean;except?:Element|null}={}):{lines:Line[];text:string;facts:Fact[]}{
 const lines:Line[]=[],found:Fact[]=[],links:Fact[]=[];
 let current='',chars=0,nodes=0,section='',structured=0;
 const flush=(heading=false)=>{
  const text=current.replace(/[  ]+/g,' ').replace(/ ?\t ?/g,'\t').replace(/^\t+|\t+$/g,'').trim();current='';
  if(!text)return;
  lines.push(heading?{text,heading}:structured?{text,structured:true}:{text});chars+=text.length+1;
  if(heading)section=text.slice(0,100);
 };
 const walk=(node:Node)=>{
  if(chars>max||nodes++>MAX_NODES)return;
  if(node.nodeType===3){current+=(node.nodeValue??'').replace(/\s+/g,' ');return;}
  if(node.nodeType!==1)return;
  const el=node as Element;
  if(skipped(el,except))return;
  if(el.tagName==='BR'){flush();return;}
  const block=BLOCK.has(el.tagName)||/^(row|listitem|heading|article|paragraph|table|grid)$/.test(role(el))||el.tagName==='CAPTION'||el.tagName==='LEGEND';
  const cell=CELL.has(el.tagName)||/^(cell|gridcell|columnheader|rowheader)$/.test(role(el));
  const data=facts&&(el.tagName==='TABLE'||/^(table|grid|treegrid)$/.test(role(el)))&&dataTable(el),list=facts&&el.tagName==='DL';
  if(cell){if(current.trim())current+='\t';}else if(block)flush();
  if(data)found.push(...tableFacts(el,section));
  if(list)found.push(...listFacts(el,section));
  if(facts&&el.tagName==='A'&&links.length<MAX_LINKS){const f=linkFact(el as HTMLAnchorElement);if(f)links.push(f);}
  if(data||list)structured++;
  for(const child of el.childNodes)walk(child);
  if(data||list)structured--;
  if(block&&!cell)flush(isHeading(el));
 };
 if(root)walk(root);flush();
 const text=lines.map(l=>l.heading?`\n${l.text}`:l.text.replace(/\t/g,'  ')).join('\n').trim().slice(0,max);
 // The lines' facts first (labelled values are what is wanted most), then the structure's, then links.
 return{lines,text,facts:facts?uniqueFacts([...factsOfLines(lines),...found,...links],MAX_FACTS):[]};
}
