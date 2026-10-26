/// <reference types="chrome" />
import {diffWords} from 'diff';
import {fieldOf,type Field} from './fields/field';
import {snapshot,textMap,rangeOf,selectionIn} from './fields/text';
import {caretOf} from './fields/caret';
import {insert,select} from './fields/insert';
import {readContext} from './context';
import {layer,surface} from './ui/root';
import {hideGhost} from './ui/ghost';
import {deepActive} from './dom';
import {post,listen} from './port';
import {loadSettings,onSettings,activeOn,type Settings} from '../shared/settings';
import {htmlToMarkdown,markdownToHtml,plainOf,hasFormatting} from '../shared/richtext';
/** Ctrl+K in a page. Pressed in a field (with or without a selection) or over selected text, it saves exactly what was
 * selected (the card takes the focus), opens the card beside it and warms the model's cache. An edit streams into the
 * card as a diff and changes the page only on Enter: the selection is put back, checked to still hold the same text
 * (found again by its text if the page moved it), replaced so the field's own undo takes it back, and read back.
 * Esc leaves the page exactly as it was and puts the focus back. Ctrl+K stays the site's own on sites the user chose
 * (Alt+K opens Gumbo there), and is left alone when there is no field and no selection. */
type Open={session:string;frame:HTMLIFrameElement;field:Field|null;start:number;end:number;original:string;rich:boolean;pageRange?:Range;context:{site:string;title:string;intent?:string;label?:string;before:string;after:string};request?:string;mode?:'edit'|'answer'|'act';text:string;final:boolean;action?:any;html?:string};
let settings:Settings|undefined,open:Open|null=null,seq=0;
const site=()=>location.hostname.replace(/^www\./,'');

export function startInline(){
 void loadSettings().then(s=>{settings=s;});onSettings(s=>{settings=s;});
 window.addEventListener('keydown',onKey,true);
 listen(onMessage);
}
function onKey(event:KeyboardEvent){
 if(!settings||!activeOn(settings,location.hostname)||event.isComposing)return;
 const alt=settings.altK.includes(site());
 const pressed=alt?event.altKey&&!event.ctrlKey&&!event.metaKey&&event.code==='KeyK':(event.ctrlKey||event.metaKey)&&!event.altKey&&!event.shiftKey&&event.code==='KeyK';
 if(!pressed)return;
 const field=fieldOf(deepActive()),pageText=field?'':(getSelection()?.toString()??'').trim();
 if(!field&&!pageText)return;
 event.preventDefault();event.stopImmediatePropagation();
 if(open)close(true);
 begin(field);
}
function begin(field:Field|null){
 hideGhost();
 const session=crypto.randomUUID();let start=0,end=0,original='',rich=false,anchor:DOMRect|undefined,pageRange:Range|undefined,before='',after='';
 if(field){
  const snap=snapshot(field,1500,1500);if(!snap)return;
  start=snap.start;end=snap.end;original=snap.selected;before=snap.before;after=snap.after;
  // A selection in a rich editor goes to the model as light Markdown, so its formatting survives.
  if(field.kind==='editable'&&snap.range&&!snap.range.collapsed){const md=htmlToMarkdown(snap.range.cloneContents());if(hasFormatting(md)){original=md;rich=true;}}
  anchor=snap.range&&!snap.range.collapsed?snap.range.getBoundingClientRect():undefined;
  if(!anchor||!anchor.height){layer();const caret=caretOf(field);anchor=caret?new DOMRect(caret.x,caret.top,1,caret.height):field.el.getBoundingClientRect();}
 }else{
  const selection=getSelection()!;pageRange=selection.getRangeAt(0).cloneRange();original=selection.toString().trim();anchor=pageRange.getBoundingClientRect();
 }
 const context=field?readContext(field):undefined;
 const frame=document.createElement('iframe');
 frame.src=chrome.runtime.getURL('card.html')+'#s='+session;frame.allow='clipboard-write';frame.setAttribute('allowtransparency','true');
 const width=Math.min(560,innerWidth-16),left=Math.max(8,Math.min(anchor.left-10,innerWidth-width-8)),below=anchor.bottom+4,above=anchor.top-4;
 Object.assign(frame.style,{position:'fixed',left:`${left}px`,top:`${below+150>innerHeight&&above>150?Math.max(8,above-150):below}px`,width:`${width}px`,height:'72px',border:'0',background:'transparent',colorScheme:'normal',pointerEvents:'auto',zIndex:'2147483647'});
 layer();surface().appendChild(frame);
 open={session,frame,field,start,end,original,rich,pageRange,context:{site:site(),title:document.title,intent:context?.intent,label:context?.label,before,after},text:'',final:false};
 post({type:'card.open',session});
 post({type:'inline.prewarm',...stableOf(open)});
}
const stableOf=(o:Open)=>({site:o.context.site,title:o.context.title,intent:o.context.intent,label:o.context.label,selection:o.original,before:o.context.before,after:o.context.after,inField:!!o.field});
const view=(o:Open,v:Record<string,unknown>)=>post({type:'card.to',session:o.session,payload:{type:'view',...v}});

function onMessage(message:any){
 if(!open)return;
 if(message?.type==='card.from'&&message.session===open.session){
  const p=message.payload,o=open;
  if(p.type==='ready'){view(o,{state:'ask',inField:!!o.field,selected:o.original});return;}
  if(p.type==='height'){o.frame.style.height=`${Math.min(innerHeight-16,p.px+2)}px`;const rect=o.frame.getBoundingClientRect();if(rect.bottom>innerHeight-8)o.frame.style.top=`${Math.max(8,innerHeight-8-rect.height)}px`;return;}
  if(p.type==='submit'){ask(o,p.instruction,p.previous);return;}
  if(p.type==='keep'){void keep(o);return;}
  if(p.type==='do'){if(o.action)post({type:'inline.do',action:o.action,title:document.title});close(false);return;}
  if(p.type==='copied'||p.type==='discard'||p.type==='closed'){close(true);return;}
 }
 if(message?.type==='inline.text'&&message.id===open.request){
  const o=open;o.mode=message.mode;o.final=message.final;
  if(message.error){view(o,{state:'error',error:message.error.includes('Sign in')?'Sign in to Gumbo to use Ctrl+K.':message.error});return;}
  if(o.mode==='act'){o.action=message.action;view(o,{state:message.final?'act':'working',text:message.text,final:message.final});return;}
  o.text=message.text;
  if(o.mode==='edit'){
   const plain=o.rich?plainOf(o.text):o.text,old=o.rich?plainOf(o.original):o.original;
   view(o,{state:message.final?'edit':'working',old:o.original?old:undefined,text:plain,final:message.final,inField:!!o.field,diff:message.final&&o.original?diffWords(old,plain).map(part=>({t:part.added?'add':part.removed?'del':'same',v:part.value})):undefined});
  }else view(o,{state:message.final?'answer':'working',text:o.text,final:message.final,sources:message.sources});
 }
}
function ask(o:Open,instruction:string,previous?:string){
 if(o.request)post({type:'cancel',id:o.request});
 o.request=`k${++seq}`;o.text='';o.final=false;o.action=undefined;
 post({type:'inline',id:o.request,...stableOf(o),instruction,previous});
}
/** Puts the kept edit into the field: the selection back, its text checked, replaced with the field's own undo, read back. */
async function keep(o:Open){
 const field=o.field;if(!field||o.mode!=='edit'){close(true);return;}
 const now=snapshot(field,1e9,1e9),plainOriginal=o.rich?plainOf(o.original):o.original;
 let {start,end}=o;
 if(now&&now.text.slice(start,end).replace(/\s+/g,' ')!==plainOriginal.replace(/\s+/g,' ')){
  // The text moved (the page changed under the card): find it again, nearest the old place.
  const at=findNear(now.text,plainOriginal,start);if(at<0){view(o,{state:'error',error:'The selected text changed on the page, so nothing was replaced.'});return;}
  start=at;end=at+plainOriginal.length;
 }
 o.frame.remove();field.el.focus({preventScroll:true});
 const text=o.rich?plainOf(o.text):o.text,html=o.rich||(field.kind==='editable'&&hasFormatting(o.text))?markdownToHtml(o.text):undefined;
 const done=await insert(field,text,{from:start,to:end,html});
 if(!done.ok){post({type:'failure',site:location.hostname,editor:field.editor,what:'insert',detail:`Ctrl+K: ${done.reason}`});try{await navigator.clipboard.writeText(text);}catch{}}
 finish(o);
}
function findNear(text:string,needle:string,near:number){
 if(!needle)return near<=text.length?near:-1;
 let best=-1;for(let i=text.indexOf(needle);i>=0;i=text.indexOf(needle,i+1))if(best<0||Math.abs(i-near)<Math.abs(best-near))best=i;
 return best;
}
/** Closes the card; with restore, the focus and selection go back to where they were. */
function close(restore:boolean){
 const o=open;if(!o)return;
 if(o.request&&!o.final)post({type:'cancel',id:o.request});
 o.frame.remove();
 if(restore){
  if(o.field){o.field.el.focus({preventScroll:true});select(o.field,o.start,o.end);}
  else if(o.pageRange){const s=getSelection();s?.removeAllRanges();s?.addRange(o.pageRange);}
 }
 finish(o);
}
function finish(o:Open){post({type:'card.close',session:o.session});if(open===o)open=null;}
export {textMap,rangeOf,selectionIn};
