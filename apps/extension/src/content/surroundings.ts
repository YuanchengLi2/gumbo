import {squash,cut,parentOf,BLOCK} from './dom';
import {saidNow} from './digest';
import {sensitive} from './fields/field';
import type {Message} from './context';
/** The text around the cursor on the page, read from the field outward, closest first, within about 1,500 characters,
 * from the page's structure alone (the same on every site):
 * - its label, with the hint or error tied to it;
 * - the question or prompt just above it: the text before it in its container, then in the containers around it, up to
 *   the heading it is under (what a form, a quiz or a chat with one message asks);
 * - in a table or grid, its column's header, the row's other cells and the values just above it in the column;
 * - the chain of section headings it is under;
 * - the text just after it (a hint, a limit, the rest of the sentence);
 * - what the page is telling them now (digest.ts);
 * - the other words in view, nearest the field first.
 * A conversation above the field is read as messages (threadAbove), so its text is not repeated here. A search box gets
 * only its label and heading: the page's words would end up in the box. */
const SKIP='script,style,noscript,template,svg,canvas,iframe,nav,[role=navigation],[aria-hidden=true],[hidden],gumbo-layer';
const VIEW_SKIP=`${SKIP},header,footer,aside,[role=banner],[role=contentinfo],[role=complementary],[contenteditable=true],[contenteditable=""],textarea`;
const HEADING='h1,h2,h3,h4,h5,h6,[role=heading]';
const CELL='td,th,[role=gridcell],[role=cell],[role=columnheader],[role=rowheader]';
const TABLE='table,[role=grid],[role=table],[role=treegrid]';
const BLOCKS='p,li,h1,h2,h3,h4,h5,h6,blockquote,pre,td,th,dd,dt,label,legend,figcaption,[role=listitem],[role=article],[role=gridcell],[role=cell]';

export function surroundingsOf(el:HTMLElement,o:{label:string;search?:boolean;thread?:Message[]},max=1500):string[]|undefined{
 const lines:string[]=[];let left=max;
 const add=(line:string|undefined)=>{if(!line||left<30)return;const kept=cut(line,left);lines.push(kept);left-=kept.length+1;};
 const known=()=>[o.label,...lines,...(o.thread??[]).map(m=>m.text)].join('\n');
 const hint=squash(['aria-describedby','aria-errormessage'].flatMap(a=>(el.getAttribute(a)??'').split(/\s+/)).filter(Boolean).map(id=>el.ownerDocument.getElementById(id)?.textContent??'').join(' '));
 if(o.label||hint)add(`Label: ${[o.label,hint].filter(Boolean).join(' — ')}`);
 const headings=headingChain(el),under=headings.length?`Under: ${headings.join(' › ')}`:undefined;
 if(o.search){add(under);return lines.length?lines:undefined;}
 // Text already read as the conversation's messages is left out; the block holding the last message is where the
 // conversation begins, so nothing above it is read.
 const last=o.thread?.at(-1)?.text.slice(0,60);
 const judge=(text:string)=>last&&text.includes(last)?'stop':known().includes(text)?'drop':'keep';
 const above=nearText(el,'before',600,judge);if(above)add(`Just above: ${above}`);
 add(tableLine(el));
 add(under);
 const after=nearText(el,'after',250,judge);if(after)add(`Just after: ${after}`);
 const said=saidNow().filter(s=>!known().includes(s));if(said.length)add(`The page says: ${said.join(' / ')}`);
 if(left>80){const view=inViewText(el,left-20,known());if(view)add(`Also in view: ${view}`);}
 return lines.length?lines:undefined;
}

/** What a person sees of a node: its text without hidden parts (innerText), or the raw text of a very large block, where
 * innerText would lay out the page. */
function textOf(node:Node):string{
 if(node.nodeType===3)return squash(node.textContent??'');
 if(!(node instanceof Element)||node.matches(SKIP))return '';
 return squash((node.textContent?.length??0)>20000?node.textContent??'':(node as HTMLElement).innerText??node.textContent??'');
}
/** The text before (or after) the field in its container, then in the containers around it, nearest first, until a
 * heading (another section begins) or max characters; returned in page order. In a table the other rows are skipped (the
 * table line reads them) and it goes on above the table. */
function nearText(el:Element,dir:'before'|'after',max:number,judge:(text:string)=>'keep'|'drop'|'stop'):string{
 const doc=el.ownerDocument,cell=el.closest(CELL),table=cell?.closest(TABLE);
 const pieces:{text:string;block:boolean}[]=[];let size=0;
 // Blocks are kept apart (a question, then its hint); inline text runs on as it reads.
 const done=()=>{
  const ordered=dir==='before'?pieces.reverse():pieces,text=ordered.map((p,i)=>(i?p.block||ordered[i-1].block?' / ':' ':'')+p.text).join('');
  return dir==='after'?cut(text,max):text.length>max?'…'+text.slice(-(max-1)).trimStart():text;
 };
 for(let node:Node|null=el,depth=0;node&&node!==doc.body&&node!==doc.documentElement&&depth<16;node=parentOf(node),depth++){
  if(table&&table.contains(node)&&node!==table&&!(cell!.contains(node)&&node!==cell))continue;
  for(let s=dir==='before'?node.previousSibling:node.nextSibling;s&&size<max;s=dir==='before'?s.previousSibling:s.nextSibling){
   if(s instanceof Element&&s.matches(HEADING))return done();
   // A block holding a heading: only its part on this side of the heading is in this section.
   const headings=s instanceof Element&&!s.matches(SKIP)?[...s.querySelectorAll(HEADING)]:[];
   let text=textOf(s);
   if(headings.length){const h=textOf(dir==='before'?headings.at(-1)!:headings[0]);const at=dir==='before'?text.lastIndexOf(h):text.indexOf(h);if(h&&at>=0)text=(dir==='before'?text.slice(at+h.length):text.slice(0,at)).trim();}
   if(text){const verdict=judge(text);if(verdict==='stop')return done();if(verdict==='keep'){pieces.push({text,block:s instanceof Element&&BLOCK.has(s.tagName)});size+=text.length+1;}}
   if(headings.length)return done();
  }
  if(size>=max)break;
 }
 return done();
}
/** In a table or grid: its caption, the column's header, the row's other cells (each under its header) and the values just
 * above in the column, so a cell is written as its column asks ("Amount": a sum like the ones above it). */
function tableLine(el:Element):string|undefined{
 const cell=el.closest(CELL),row=cell?.closest('tr,[role=row]'),table=row?.closest(TABLE);if(!cell||!row||!table)return;
 const doc=el.ownerDocument,rows=[...table.querySelectorAll('tr,[role=row]')].filter(r=>r.closest(TABLE)===table).slice(0,500);
 const cellsOf=(r:Element)=>[...r.children].filter(c=>c.matches(CELL));
 const columnOf=(c:Element)=>{const aria=Number(c.getAttribute('aria-colindex'));if(aria)return aria;let n=1;for(const p of cellsOf(c.parentElement!)){if(p===c)return n;n+=(p as HTMLTableCellElement).colSpan||1;}return n;};
 const at=(r:Element,col:number)=>cellsOf(r).find(c=>columnOf(c)===col);
 const valueOf=(c:Element)=>{
  const f=c.querySelector<HTMLElement>('input,textarea,select,[contenteditable=true],[role=textbox]');
  if(f&&!sensitive(f))return cut(squash(f instanceof HTMLInputElement||f instanceof HTMLTextAreaElement?f.value:f instanceof HTMLSelectElement?f.selectedOptions[0]?.text??'':textOf(f)),60);
  return cut(textOf(c),60);
 };
 const heads=rows.filter(r=>{const cs=cellsOf(r);return r.parentElement?.tagName==='THEAD'||cs.length>0&&cs.every(c=>c.matches('th,[role=columnheader]'));});
 const header=(c:Element)=>{
  const ids=c.getAttribute('headers');if(ids){const text=squash(ids.split(/\s+/).map(id=>doc.getElementById(id)?.textContent??'').join(' '));if(text)return cut(text,60);}
  const col=columnOf(c);return heads.filter(r=>r!==c.parentElement).map(r=>at(r,col)).map(h=>h?valueOf(h):'').filter(Boolean).join(' › ');
 };
 const caption=squash(table.querySelector(':scope > caption')?.textContent??table.getAttribute('aria-label')??'');
 const others=cellsOf(row).filter(c=>c!==cell).map(c=>{const h=header(c),v=valueOf(c);return v?h?`${h}: ${v}`:v:'';}).filter(Boolean).slice(0,8);
 const index=rows.indexOf(row),col=columnOf(cell);
 const above=rows.slice(Math.max(0,index-3),index).filter(r=>!heads.includes(r)).map(r=>at(r,col)).map(c=>c?valueOf(c):'').filter(Boolean);
 const own=header(cell);
 const parts=[caption&&`the table “${cut(caption,80)}”`,own?`the cell under “${own}”`:'a cell',others.length&&`its row: ${others.join(' · ')}`,above.length&&`above it in the column: ${above.join(' · ')}`].filter(Boolean);
 return own||others.length||above.length?`In a table: ${parts.join('; ')}`:undefined;
}
/** The headings the field is under, outermost first: the nearest heading before it, then the nearest before that of a
 * higher level, and so on. */
function headingChain(el:Element):string[]{
 const all=[...el.ownerDocument.querySelectorAll(HEADING)].slice(0,500),out:string[]=[];let level=7;
 for(let i=all.length-1;i>=0&&level>1;i--){
  const h=all[i];if(h.contains(el)||!(h.compareDocumentPosition(el)&Node.DOCUMENT_POSITION_FOLLOWING)||h.closest(SKIP))continue;
  const l=Number(h.getAttribute('aria-level'))||Number(h.tagName[1])||2;if(l>=level)continue;
  const text=cut(textOf(h),100);if(!text)continue;
  out.unshift(text);level=l;
 }
 return out;
}
/** The blocks of text in view (never menus, page chrome or fields), nearest the field first up to max characters, read in
 * page order. */
function inViewText(el:Element,max:number,known:string):string{
 const doc=el.ownerDocument,height=doc.defaultView?.innerHeight??0;if(!doc.body||!height)return '';
 const r=el.getBoundingClientRect(),y=(r.top+r.bottom)/2,found:{block:Element;text:string;far:number}[]=[];
 for(const block of [...doc.body.querySelectorAll(BLOCKS)].slice(0,1500)){
  if(block.contains(el)||block.parentElement?.closest(BLOCKS))continue;
  const b=block.getBoundingClientRect();if(b.width<1||b.bottom<0||b.top>height||block.closest(VIEW_SKIP))continue;
  const text=textOf(block);if(text.length<2||known.includes(text.slice(0,80)))continue;
  found.push({block,text:cut(text,200),far:Math.abs((b.top+b.bottom)/2-y)});
 }
 const kept:typeof found=[];let size=0;
 for(const f of found.sort((a,b)=>a.far-b.far)){if(size+f.text.length>max)break;kept.push(f);size+=f.text.length+3;}
 return kept.sort((a,b)=>a.block.compareDocumentPosition(b.block)&Node.DOCUMENT_POSITION_FOLLOWING?-1:1).map(f=>f.text).join(' / ');
}
