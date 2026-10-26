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
import {pageText} from './capture';
import {loadSettings,onSettings,activeOn,type Settings} from '../shared/settings';
import {htmlToMarkdown,markdownToHtml,plainOf,hasFormatting} from '../shared/richtext';
/** Ctrl+K in a page. Pressed in a field (with or without a selection) or over selected text, it saves exactly what was
 * selected (the card takes the focus), opens the card beside it and warms the model's cache. An edit streams into the
 * card as a diff and changes the page only on Enter: the selection is put back, checked to still hold the same text
 * (found again by its text if the page moved it), replaced so the field's own undo takes it back, and read back.
 * Esc leaves the page exactly as it was and puts the focus back. As it opens it offers what the user most likely wants
 * (from the selection at once, then from the page, the conversation and memory). Something to do in the page runs there,
 * step by step, with its steps in the card and Enter to allow a final one. Ctrl+K stays the site's own on sites the user
 * chose (Alt+K opens Gumbo there), and is left alone when there is no field and no selection. */
type Open={session:string;frame:HTMLIFrameElement;field:Field|null;start:number;end:number;original:string;rich:boolean;pageRange?:Range;context:{site:string;title:string;intent?:string;label?:string;before:string;after:string};request?:string;mode?:'edit'|'answer'|'act';text:string;final:boolean;action?:any;html?:string;
 /** Something being done in the page: the agent's conversation, the final step waiting for Enter, whether it ended. */doing?:{chat?:string;confirm?:string;done?:boolean};
 /** Keys pressed before the card could take them (it is still loading): they go to the card, never to the page. */early:string[];ready:boolean};
let settings:Settings|undefined,open:Open|null=null,seq=0;
const site=()=>location.hostname.replace(/^www\./,'');

export function startInline(){
 void loadSettings().then(s=>{settings=s;});onSettings(s=>{settings=s;});
 window.addEventListener('keydown',onKey,true);
 window.addEventListener('keydown',onDoingKey,true);
 window.addEventListener('keydown',onEarlyKey,true);
 listen(onMessage);
}
/** Typing straight after Ctrl+K: the card takes a moment to load, and what is typed meanwhile is held and handed to it,
 * so no key is lost and none reaches the page (where it would replace the selection). */
function onEarlyKey(event:KeyboardEvent){
 if(!open||open.ready||!event.isTrusted||event.isComposing||event.ctrlKey||event.metaKey||event.altKey)return;
 if(event.key.length!==1&&!['Enter','Escape','Backspace','Tab','ArrowDown','ArrowUp'].includes(event.key))return;
 event.preventDefault();event.stopImmediatePropagation();open.early.push(event.key);
}
/** While Ctrl+K does something in the page the focus may be in the page (the agent typed there): Enter and Esc still
 * answer the card's question, and Esc stops. */
function onDoingKey(event:KeyboardEvent){
 const d=open?.doing;if(!d||!open||document.activeElement===open.frame)return;
 if(event.key==='Enter'&&d.confirm){event.preventDefault();event.stopImmediatePropagation();answer(open,true);}
 else if(event.key==='Escape'){event.preventDefault();event.stopImmediatePropagation();if(d.confirm)answer(open,false);else if(d.done)close(false);else stopDoing(open);}
}
function onKey(event:KeyboardEvent){
 if(!settings||!activeOn(settings,location.hostname)||event.isComposing)return;
 const alt=settings.altK.includes(site());
 const pressed=alt?event.altKey&&!event.ctrlKey&&!event.metaKey&&event.code==='KeyK':(event.ctrlKey||event.metaKey)&&!event.altKey&&!event.shiftKey&&event.code==='KeyK';
 if(!pressed)return;
 const field=fieldOf(deepActive()),pageText=field?'':(getSelection()?.toString()??'').trim();
 if(!field&&!pageText){
  // Nothing selected and no field: the page has the key first (many sites use Ctrl+K). A listener added now runs after
  // all of the page's (last, as the key leaves the window), still in time to keep Chrome from taking the key itself.
  if(window===window.top)window.addEventListener('keydown',e=>{if(e!==event||e.defaultPrevented)return;e.preventDefault();if(open)close(true);begin(null);},{once:true});
  return;
 }
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
  const selection=getSelection();
  if(selection&&selection.rangeCount&&selection.toString().trim()){pageRange=selection.getRangeAt(0).cloneRange();original=selection.toString().trim();anchor=pageRange.getBoundingClientRect();}
  // The whole page: the card opens at the top, and the page's text goes with the request.
  else{anchor=new DOMRect(innerWidth/2-280,64,560,0);before=pageText(6000);}
 }
 const context=field?readContext(field):undefined;
 const frame=document.createElement('iframe');
 frame.src=chrome.runtime.getURL('card.html')+'#s='+session;frame.allow='clipboard-write';frame.setAttribute('allowtransparency','true');
 const width=Math.min(560,innerWidth-16),left=Math.max(8,Math.min(anchor.left-10,innerWidth-width-8)),below=anchor.bottom+4,above=anchor.top-4;
 Object.assign(frame.style,{position:'fixed',left:`${left}px`,top:`${below+150>innerHeight&&above>150?Math.max(8,above-150):below}px`,width:`${width}px`,height:'72px',border:'0',background:'transparent',colorScheme:'normal',pointerEvents:'auto',zIndex:'2147483647'});
 layer();surface().appendChild(frame);
 open={session,frame,field,start,end,original,rich,pageRange,context:{site:site(),title:document.title,intent:context?.intent,label:context?.label,before,after},text:'',final:false,early:[],ready:false};
 post({type:'card.open',session});
 // A card that never comes up (the extension was updated under the page, the worker could not answer) must not keep
 // the keys: the page gets them and its selection back.
 const opened=open;setTimeout(()=>{if(opened&&open===opened&&!opened.ready){post({type:'failure',site:location.hostname,editor:field?.editor??'page',what:'card',detail:'Ctrl+K card did not start'});close(true);}},4000);
 post({type:'inline.prewarm',...stableOf(open)});
 post({type:'inline.predict',session,...stableOf(open),thread:context?.thread?.slice(-2).map(m=>`${m.author?`${m.author}: `:''}${m.text.slice(0,500)}`).join('\n')});
}
const stableOf=(o:Open)=>({site:o.context.site,title:o.context.title,intent:o.context.intent,label:o.context.label,selection:o.original,before:o.context.before,after:o.context.after,inField:!!o.field});
const view=(o:Open,v:Record<string,unknown>)=>post({type:'card.to',session:o.session,payload:{type:'view',...v}});

function onMessage(message:any){
 if(!open)return;
 if(message?.type==='card.from'&&message.session===open.session){
  const p=message.payload,o=open;
  if(p.type==='ready'){
   // The card has the keys from now on (focused from here too: a frame cannot always take the focus by itself), with
   // whatever was typed while it loaded.
   o.ready=true;o.frame.focus();
   // No state with it: the card starts asking, and may already be working on what was typed straight into it.
   view(o,{inField:!!o.field,selected:o.original});
   // Always sent, empty or not: the card holds what is typed into it until this arrives, to keep the order.
   post({type:'card.to',session:o.session,payload:{type:'keys',keys:o.early}});o.early=[];
   post({type:'card.to',session:o.session,payload:{type:'focus'}});
   return;
  }
  if(p.type==='height'){o.frame.style.height=`${Math.min(innerHeight-16,p.px+2)}px`;const rect=o.frame.getBoundingClientRect();if(rect.bottom>innerHeight-8)o.frame.style.top=`${Math.max(8,innerHeight-8-rect.height)}px`;return;}
  if(p.type==='submit'){if(p.kind==='page')doInPage(o,p.instruction);else ask(o,p.instruction,p.previous);return;}
  if(p.type==='keep'){void keep(o);return;}
  if(p.type==='do'){if(o.action?.do==='page')doInPage(o,o.action.task);else{if(o.action)post({type:'inline.do',action:o.action,title:document.title});close(false);}return;}
  if(p.type==='confirm'){answer(o,!!p.yes);return;}
  if(p.type==='stop'){stopDoing(o);return;}
  if(p.type==='copied'||p.type==='discard'||p.type==='closed'){close(true);return;}
 }
 if(message?.type==='inline.ideas'&&message.session===open.session){view(open,{ideas:message.items});return;}
 if(message?.type==='inline.steps'&&message.session===open.session){
  const o=open;o.doing={chat:message.chat,confirm:message.confirm?.id,done:!!message.done};
  view(o,{state:'doing',steps:message.steps,confirm:message.confirm,said:message.said,status:message.status,error:message.error,done:!!message.done});return;
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
/** Something to do in the page: the agent does it in this tab, its steps shown in the card. */
function doInPage(o:Open,task:string){
 if(o.request&&!o.final)post({type:'cancel',id:o.request});
 o.doing={};view(o,{state:'doing',steps:[],said:'',done:false,confirm:undefined});
 post({type:'inline.page',session:o.session,task,selection:o.original||undefined});
}
function answer(o:Open,yes:boolean){if(o.doing?.chat&&o.doing.confirm){post({type:'agent.confirm',chat:o.doing.chat,id:o.doing.confirm,yes});o.doing.confirm=undefined;}}
function stopDoing(o:Open){if(o.doing?.chat&&!o.doing.done)post({type:'agent.stop',chat:o.doing.chat});close(false);}
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
