import {on} from './surfaces';
import {model} from './model';
import {add} from './db';
import {invalidate,recallFor} from './recall';
import {relevant,heardJustNow,asksAboutNow,type Remembered} from './memory-context';
import {workspace,justLeft,justLeftText} from './workspace';
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
type Ask={id:string;session?:string;site:string;title:string;intent?:string;label?:string;selection:string;before:string;after:string;inField:boolean;instruction:string;previous?:string;
 /** The page is drawn as pixels (a document, a design): a picture of the view goes with the question. */drawn?:boolean;view?:[number,number]};
const warmed=new Map<string,number>();
const timeZone=()=>Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Memory for Ctrl+K is searched as the card opens, with the selection and the page (while the instruction is typed);
 * on Enter the search with the instruction gets a moment (0.15 s), and when it needs longer the one from the opening is
 * used: the answer never waits on memory. */
const opened=new Map<string,Promise<Remembered[]>>();
/** Their browser as the agent knows it (workspace.ts), a little shorter, kept a few seconds. */
const browsers=new Map<number,{at:number;text:Promise<string>}>();
function browserOf(tab:number|undefined):Promise<string>{
 if(tab===undefined)return Promise.resolve('');
 const had=browsers.get(tab);if(had&&Date.now()-had.at<3000)return had.text;
 const text=workspace({here:tab,compact:true}).catch(()=>'');browsers.set(tab,{at:Date.now(),text});if(browsers.size>50)browsers.delete(browsers.keys().next().value!);
 return text;
}
const contextOf=(m:Omit<Ask,'id'|'instruction'>)=>`${m.selection.slice(0,300)}\n${m.title}\n${m.label??''}\n${m.before.slice(-200)}`;
const keyOf=(m:Omit<Ask,'id'|'instruction'>)=>`${m.site}|${contextOf(m).slice(0,400)}`;
async function memoryFor(m:Ask):Promise<Remembered[]>{
 const search=relevant(`${m.instruction}\n${contextOf(m)}`,{k:5}).catch(()=>[] as Remembered[]);
 const within=(ms:number)=>Promise.race([search,new Promise<null>(r=>setTimeout(()=>r(null),ms))]);
 const asked=await within(150);
 // The instruction's own search wins when it comes in time and found something; else the one from the opening.
 if(asked?.length)return asked;
 const early=opened.get(keyOf(m)),fromOpening=early?await Promise.race([early,new Promise<Remembered[]>(r=>setTimeout(()=>r([]),60))]):[];
 if(fromOpening.length)return fromOpening;
 // Nothing in hand yet (memory still starting): the question may be all about memory, so its search gets longer.
 return asked??(await within(1500))??[];
}

/** What the card knows of the browser (the tab just left, the whole browser), taken once as it opens and kept for that
 * card: the part of the prompt that holds it is the same at Enter as when it was warmed, so it comes from the cache. */
const contexts=new Map<string,{at:number;text:Promise<string>}>();
function cardContext(m:Omit<Ask,'id'|'instruction'>,tab:number|undefined):Promise<string>{
 const key=keyOf(m),had=contexts.get(key);if(had&&Date.now()-had.at<120_000)return had.text;
 const text=Promise.all([browserOf(tab),justLeft(tab)]).then(([browser,left])=>[justLeftText(left),browser].filter(Boolean).join('\n')).catch(()=>'');
 contexts.set(key,{at:Date.now(),text});if(contexts.size>30)contexts.delete(contexts.keys().next().value!);
 return text;
}
const withContext=(stable:string,context:string)=>context?`${stable}${context}\n`:stable;

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
 opened.set(keyOf(message),relevant(contextOf(message),{k:5}).catch(()=>[]));if(opened.size>30)opened.delete(opened.keys().next().value!);
 const [recall,context]=await Promise.all([recallFor({site:message.site,intent:message.intent??'other',before:message.before}),cardContext(message,port.sender?.tab?.id)]);
 const stable=withContext(inlineStable({...message,facts:settings.facts,style:recall.style}),context),key=stable.slice(0,300)+stable.length;
 if(Date.now()-(warmed.get(key)??0)<240_000)return;warmed.set(key,Date.now());if(warmed.size>100)warmed.delete(warmed.keys().next().value!);
 await model({model:settings.models.inline,system:INLINE_SYSTEM,messages:[{role:'user',content:[{type:'text',text:stable,cache_control:{type:'ephemeral'}},{type:'text',text:'.'}]}],max_tokens:0,stream:false,purpose:'prewarm'}).catch(()=>{});
});

/** What Ctrl+K offers as it opens: the instant ideas from the selection at once, then the model's, from the page, the
 * conversation and memory (a fast call, a few hundred milliseconds). */
on('inline.predict',async(message:Omit<Ask,'id'|'instruction'>&{session:string;thread?:string},{send,url,port})=>{
 const settings=await loadSettings();if(!activeOn(settings,siteOf(url)||message.site))return;
 const quick=quickIdeas({selection:message.selection,inField:message.inField,intent:message.intent,before:message.before,thread:message.thread});
 if(quick.length)send({type:'inline.ideas',session:message.session,items:quick,final:false});
 try{
  // The same memory as the agent: what memory holds about this, their whole browser, and the tab they just left.
  const [memory,just]=await Promise.all([Promise.race([relevant(`${message.selection.slice(0,300)}\n${message.title}\n${message.label??''}\n${message.thread??''}`,{k:5}).catch(()=>[]),new Promise<[]>(r=>setTimeout(()=>r([]),300))]),cardContext(message,port.sender?.tab?.id)]);
  const stable=inlineStable({...message,facts:settings.facts});
  const extra=(message.thread?`<conversation_above>\n${message.thread.slice(0,1200)}\n</conversation_above>\n`:'')+(memory.length?`<their_memory>\n${memory.map(m=>`${m.title} (${m.when}): ${m.text.slice(0,300)}`).join('\n')}\n</their_memory>\n`:'')+(just?just+'\n':'');
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
 const [recall,found,heard,context,shot]=await Promise.all([
  recallFor({site:message.site,intent:message.intent??'other',before:message.before}),
  memoryFor(message),
  asksAboutNow(message.instruction)?heardJustNow():Promise.resolve(undefined),
  cardContext(message,port.sender?.tab?.id),
  message.drawn&&!port.sender?.frameId?(message.session&&held.get(message.session))||viewPicture(port.sender?.tab,message.view):Promise.resolve(null),
 ]);
 const picture=shot?[{type:'image',source:{type:'base64',media_type:'image/jpeg',data:shot.data}},{type:'text',text:'This page is drawn as pixels: what it shows (its text, its design) is in this picture of their view. Words highlighted in it (a tinted band behind them) are what they selected, even when no selection is given above: "this" means those words, and an edit is new text for exactly them.'}]:[];
 const memory=[...(heard?[heard]:[]),...found].map((m,i)=>({n:i+1,title:m.title,url:m.url,when:m.when,text:m.text}));
 const stable=withContext(inlineStable({...message,facts:settings.facts,style:recall.style}),context);
 const fresh=inlineFresh({instruction:message.instruction,now:new Date(),timeZone:timeZone(),memory,previous:message.previous});
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
 try{
  await model({model:settings.models.inline,system:INLINE_SYSTEM,messages:[{role:'user',content:[{type:'text',text:stable,cache_control:{type:'ephemeral'}},...picture,{type:'text',text:fresh}]}],max_tokens:room,purpose:'inline'},{signal,onEvent:event=>{
   if(event.data?.type!=='content_block_delta'||event.data.delta?.type!=='text_delta')return;
   raw+=event.data.delta.text;const body=parse(false);
   if(body!==null&&mode!=='act'&&body!==sent){sent=body;send({type:'inline.text',id:message.id,mode,text:shape(body,message),final:false});}
  }});
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
