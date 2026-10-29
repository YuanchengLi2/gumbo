import {on} from './surfaces';
import {model} from './model';
import {add} from './db';
import {invalidate,recallFor} from './recall';
import {heardJustNow,asksAboutNow} from './memory-context';
import {getContext} from './memory/context';
import {GRAPH_TOOLS,runGraphTool} from './memory/graph';
import {viewPicture} from './predict';
import {offscreen} from './offscreen';
import {loadSettings,activeOn,siteOf} from '../shared/settings';
import {INLINE_SYSTEM,PREDICT_SYSTEM,inlineStable,inlineFresh} from '../shared/prompts';
import {quickIdeas,mergeIdeas,ideasOf} from '../shared/ideas';
import {textOf} from '../shared/gateway';
import {actionOf,type Action} from './inline-action';
/** Ctrl+K in the engine. The card's opening warms the cache with everything but the instruction; on Enter the model
 * names a mode on its first line (edit, answer, act) and the rest streams back. An edit is only the new text; an answer
 * may cite memory, whose items go back with it as links; an action comes as one JSON object, turned here into a link to
 * open (a prefilled calendar event, a search) or a note to keep. Nothing on the page changes until the user keeps it. */
type Ask={id:string;session?:string;site:string;title:string;intent?:string;label?:string;selection:string;before:string;after:string;page?:string;inField:boolean;instruction:string;previous?:string;
 /** The page is drawn as pixels (a document, a design): a picture of the view goes with the question. */drawn?:boolean;view?:[number,number]};
const warmed=new Map<string,number>();
const timeZone=()=>Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Memory for Ctrl+K is the one every surface has (memory/context.ts): asked as the card opens, with the selection and
 * the page (its search and a Haiku rerank run while the instruction is typed), and again on Enter with the instruction,
 * whose own search gets a moment (0.15 s) and otherwise the one from the opening stands: the answer never waits on
 * memory. Its stable part (who they are, what they are working on) is the same from opening to Enter, so it is cached. */
const contextOf=(m:Omit<Ask,'id'|'instruction'>)=>`${m.selection.slice(0,300)}\n${m.title}\n${m.label??''}\n${m.before.slice(-200)||(m.page??"").slice(0,300)}`;
const keyOf=(m:Omit<Ask,'id'|'instruction'>)=>`inline|${m.site}|${contextOf(m).slice(0,400)}`;
const bundleFor=(m:Omit<Ask,'id'|'instruction'>&{instruction?:string},tab:number|undefined,url:string,wait:number)=>getContext({surface:'inline',tab,url,query:m.instruction?`${m.instruction}\n${contextOf(m)}`:contextOf(m),field:m.inField?{intent:m.intent??'other',label:m.label??''}:undefined,budget:4000,key:keyOf(m),rerank:true,wait});
/** The picture taken as a card opened over a drawing, while what they selected was still highlighted as they saw it (it
 * fades once the card has the focus): the card's questions look at it. */
const held=new Map<string,ReturnType<typeof viewPicture>>();
on('inline.picture',(m:{session:string;view:[number,number]},{port})=>{
 held.set(m.session,viewPicture(port.sender?.tab,m.view,true));if(held.size>20)held.delete(held.keys().next().value!);
});

on('inline.prewarm',async(message:Omit<Ask,'id'|'instruction'>,{url,port})=>{
 const settings=await loadSettings();if(!activeOn(settings,siteOf(url)||message.site))return;
 // Memory and its model get ready while the instruction is typed (a moment after the card has opened and has the keys).
 setTimeout(()=>void offscreen({type:'index.warm'}).catch(()=>{}),400);
 const [recall,bundle]=await Promise.all([recallFor({site:message.site,intent:message.intent??'other',before:message.before}),bundleFor(message,port.sender?.tab?.id,url,0)]);
 const stable=inlineStable({...message,facts:settings.facts,style:recall.style,memory:bundle.stable}),key=stable.slice(0,300)+stable.length;
 if(Date.now()-(warmed.get(key)??0)<240_000)return;warmed.set(key,Date.now());if(warmed.size>100)warmed.delete(warmed.keys().next().value!);
 await model({model:settings.models.inline,system:INLINE_SYSTEM,tools:GRAPH_TOOLS,messages:[{role:'user',content:[{type:'text',text:stable,cache_control:{type:'ephemeral'}},{type:'text',text:'.'}]}],max_tokens:0,stream:false,purpose:'prewarm'}).catch(()=>{});
});

/** What Ctrl+K offers as it opens: the instant ideas from the selection at once, then the model's, from the page, the
 * conversation and memory (a fast call, a few hundred milliseconds). */
on('inline.predict',async(message:Omit<Ask,'id'|'instruction'>&{session:string;thread?:string},{send,url,port})=>{
 const settings=await loadSettings();if(!activeOn(settings,siteOf(url)||message.site))return;
 const quick=quickIdeas({selection:message.selection,inField:message.inField,intent:message.intent,before:message.before,thread:message.thread});
 if(quick.length)send({type:'inline.ideas',session:message.session,items:quick,final:false});
 try{
  // The same memory as every surface: who they are, what they are working on, this session and the past, ranked.
  const bundle=await bundleFor(message,port.sender?.tab?.id,url,300);
  const stable=inlineStable({...message,facts:settings.facts,memory:bundle.stable});
  const extra=(bundle.fresh?bundle.fresh+'\n':'');
  const {message:reply}=await model({model:settings.models.inline,system:PREDICT_SYSTEM,messages:[{role:'user',content:[{type:'text',text:stable+extra+'What do they most likely want?'}]}],max_tokens:180,purpose:'action',stream:false});
  send({type:'inline.ideas',session:message.session,items:mergeIdeas(ideasOf(textOf(reply)),quick),final:true});
 }catch{send({type:'inline.ideas',session:message.session,items:quick,final:true});}
});

on('inline',async(message:Ask,{send,signal,url,port})=>{
 const settings=await loadSettings();
 if(!activeOn(settings,siteOf(url)||message.site)){send({type:'inline.text',id:message.id,mode:'answer',text:'Gumbo is off on this site.',final:true});return;}
 // Memory is always part of it: all of it searched with the instruction, the selection and where it is (the page, the
 // field, the words just before), what is being heard first when the question is about what was just said, and the
 // user's own writing so an edit sounds like them.
 const [recall,bundle,heard,shot]=await Promise.all([
  recallFor({site:message.site,intent:message.intent??'other',before:message.before}),
  bundleFor(message,port.sender?.tab?.id,url,150),
  asksAboutNow(message.instruction)?heardJustNow():Promise.resolve(undefined),
  message.drawn&&!port.sender?.frameId?(message.session&&held.get(message.session))||viewPicture(port.sender?.tab,message.view):Promise.resolve(null),
 ]);
 const picture=shot?[{type:'image',source:{type:'base64',media_type:'image/jpeg',data:shot.data}},{type:'text',text:'This page is drawn as pixels: what it shows (its text, its design) is in this picture of their view. Words highlighted in it (a tinted band behind them) are what they selected, even when no selection is given above: "this" means those words, and an edit is new text for exactly them.'}]:[];
 // What is being heard comes first when the question is about what was just said.
 const memory=bundle.items.filter(i=>i.n).map(i=>({n:i.n,title:i.title,url:i.url}));
 const stable=inlineStable({...message,facts:settings.facts,style:recall.style,memory:bundle.stable});
 const fresh=(heard?`<heard_just_now title="${heard.title.replace(/"/g,'')}">\n${heard.text}\n</heard_just_now>\n`:'')+(bundle.fresh?bundle.fresh+'\n':'')+inlineFresh({instruction:message.instruction,now:new Date(),timeZone:timeZone(),memory:[],previous:message.previous});
 const room=Math.min(4000,Math.ceil(message.selection.length/3)*2+300);
 let raw='',mode:'edit'|'answer'|'act'|undefined,sent='';
 const parse=(final:boolean)=>{
  const text=raw.replace(/^\s+/,'');
  const tag=/^(EDIT|ANSWER|ACT)\b[:\s]*/i.exec(text);
  if(tag){mode=tag[1].toLowerCase() as typeof mode;return text.slice(tag[0].length);}
  // No tag: an edit when something was selected in a field, otherwise an answer (decided once enough has arrived).
  if(final||text.length>40||text.includes('\n')){mode??=message.inField?'edit':'answer';return text;}
  return null;
 };
 // It may look things up in their browsing first (memory/graph.ts: search, open, follow), three times at most, then
 // answers; what it writes streams as it comes.
 const messages:any[]=[{role:'user',content:[{type:'text',text:stable,cache_control:{type:'ephemeral'}},...picture,{type:'text',text:fresh}]}];
 try{
  for(let round=0;;round++){
   raw='';
   const {message:reply}=await model({model:settings.models.inline,system:INLINE_SYSTEM,messages,...(round<3?{tools:GRAPH_TOOLS}:{}),max_tokens:Math.max(room,600),purpose:'inline'},{signal,onEvent:event=>{
    if(event.data?.type!=='content_block_delta'||event.data.delta?.type!=='text_delta')return;
    raw+=event.data.delta.text;const body=parse(false);
    if(body!==null&&mode!=='act'&&body!==sent){sent=body;send({type:'inline.text',id:message.id,mode,text:shape(body,message),final:false});}
   }});
   const uses=(reply?.content??[]).filter((b:any)=>b.type==='tool_use');
   if(!uses.length||signal.aborted)break;
   messages.push({role:'assistant',content:reply.content});
   const results=[];
   for(const use of uses){const done=await runGraphTool(use.name,use.input??{},port.sender?.tab?.id).catch(error=>({content:`Failed: ${(error as Error).message}`,summary:''}));results.push({type:'tool_result',tool_use_id:use.id,content:done.content});}
   messages.push({role:'user',content:results});
  }
 }catch(error){if(signal.aborted)return;send({type:'inline.text',id:message.id,mode:mode??'answer',text:'',final:true,error:(error as Error).message});return;}
 const body=parse(true)??'';
 if(mode==='act'){const action=actionOf(body);send({type:'inline.text',id:message.id,mode:action?'act':'answer',text:action?action.label:'That could not be turned into an action.',action,final:true});return;}
 send({type:'inline.text',id:message.id,mode,text:shape(body,message),final:true,sources:mode==='answer'?memory.map(m=>({n:m.n,title:m.title,url:m.url})):undefined});
});

/** Ctrl+K pressed in a drawn editor's hidden typing box inside a frame (Google Docs): the card opens in the page itself. */
on('inline.top',async(m:{editable?:boolean},{port})=>{
 const tab=port.sender?.tab?.id;if(tab===undefined)return;
 await chrome.tabs.sendMessage(tab,{type:'inline.open',editable:!!m.editable},{frameId:0}).catch(()=>{});
});

/** An edit keeps the selection's own spacing at its edges; quotes or fences around the whole answer go. */
function shape(text:string,message:Ask){
 let out=text.replace(/^```[a-z]*\n?|\n?```\s*$/g,'');
 const quoted=/^\s*["“](.*)["”]\s*$/s.exec(out);if(quoted&&!/["“”]/.test(quoted[1])&&!/^["“]/.test(message.selection.trim()))out=quoted[1];
 if(!message.selection)return out.replace(/\s+$/,'');
 const lead=/^\s*/.exec(message.selection)![0],trail=/\s*$/.exec(message.selection)![0];
 return lead+out.trim()+trail;
}
on('inline.do',async(message:{action:Action;title?:string},{send,url,port})=>{
 const {action}=message;
 if(action.url)await chrome.tabs.create({url:action.url,index:(port.sender?.tab?.index??0)+1,openerTabId:port.sender?.tab?.id});
 if(action.do==='note'&&action.text){await add('notes',{text:action.text,url,title:message.title,at:Date.now(),source:'browser'});invalidate();}
 send({type:'inline.done',ok:true});
});
