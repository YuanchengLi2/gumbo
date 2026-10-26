import {on} from './surfaces';
import {model} from './model';
import {add} from './db';
import {invalidate,recallFor} from './recall';
import {relevant,heardJustNow,asksAboutNow} from './memory-context';
import {lately,latelyText} from './lately';
import {tabsBrief} from './workspace';
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
type Ask={id:string;site:string;title:string;intent?:string;label?:string;selection:string;before:string;after:string;inField:boolean;instruction:string;previous?:string};
const warmed=new Map<string,number>();
const timeZone=()=>Intl.DateTimeFormat().resolvedOptions().timeZone;

on('inline.prewarm',async(message:Omit<Ask,'id'|'instruction'>,{url})=>{
 const settings=await loadSettings();if(!activeOn(settings,siteOf(url)||message.site))return;
 // Memory and its model get ready while the instruction is typed (a moment after the card has opened and has the keys).
 setTimeout(()=>void offscreen({type:'index.warm'}).catch(()=>{}),400);
 const recall=await recallFor({site:message.site,intent:message.intent??'other',before:message.before});
 const stable=inlineStable({...message,facts:settings.facts,style:recall.style}),key=stable.slice(0,300)+stable.length;
 if(Date.now()-(warmed.get(key)??0)<240_000)return;warmed.set(key,Date.now());if(warmed.size>100)warmed.delete(warmed.keys().next().value!);
 await model({model:settings.models.inline,system:INLINE_SYSTEM,messages:[{role:'user',content:[{type:'text',text:stable,cache_control:{type:'ephemeral'}},{type:'text',text:'.'}]}],max_tokens:0,stream:false,purpose:'prewarm'}).catch(()=>{});
});

/** What Ctrl+K offers as it opens: the instant ideas from the selection at once, then the model's, from the page, the
 * conversation and memory (a fast call, a few hundred milliseconds). */
on('inline.predict',async(message:Omit<Ask,'id'|'instruction'>&{session:string;thread?:string},{send,url})=>{
 const settings=await loadSettings();if(!activeOn(settings,siteOf(url)||message.site))return;
 const quick=quickIdeas({selection:message.selection,inField:message.inField,intent:message.intent,before:message.before,thread:message.thread});
 if(quick.length)send({type:'inline.ideas',session:message.session,items:quick,final:false});
 try{
  const [memory,before,tabs]=await Promise.all([Promise.race([relevant(`${message.selection.slice(0,300)}\n${message.title}\n${message.label??''}\n${message.thread??''}`,{k:3}).catch(()=>[]),new Promise<[]>(r=>setTimeout(()=>r([]),500))]),lately(url),tabsBrief(url)]);
  const stable=inlineStable({...message,facts:settings.facts}),just=latelyText(before)+(tabs?`\n<their_open_tabs>\n${tabs}\n</their_open_tabs>`:'');
  const extra=(message.thread?`<conversation_above>\n${message.thread.slice(0,1200)}\n</conversation_above>\n`:'')+(memory.length?`<their_memory>\n${memory.map(m=>`${m.title} (${m.when}): ${m.text.slice(0,300)}`).join('\n')}\n</their_memory>\n`:'')+(just?just+'\n':'');
  const {message:reply}=await model({model:settings.models.inline,system:PREDICT_SYSTEM,messages:[{role:'user',content:[{type:'text',text:stable+extra+'What do they most likely want?'}]}],max_tokens:180,purpose:'action',stream:false});
  send({type:'inline.ideas',session:message.session,items:mergeIdeas(ideasOf(textOf(reply)),quick),final:true});
 }catch{send({type:'inline.ideas',session:message.session,items:quick,final:true});}
});

on('inline',async(message:Ask,{send,signal,url})=>{
 const settings=await loadSettings();
 if(!activeOn(settings,siteOf(url)||message.site)){send({type:'inline.text',id:message.id,mode:'answer',text:'Gumbo is off on this site.',final:true});return;}
 // Memory is always part of it: all of it searched with the instruction, the selection and where it is (the page, the
 // field, the words just before), what is being heard first when the question is about what was just said, and the
 // user's own writing so an edit sounds like them.
 const [recall,found,heard,before,tabs]=await Promise.all([
  recallFor({site:message.site,intent:message.intent??'other',before:message.before}),
  // Warmed when the card opened, so this is quick; if memory is still starting, it gets two and a half seconds at most.
  Promise.race([relevant(`${message.instruction}\n${message.selection.slice(0,300)}\n${message.title}\n${message.label??''}\n${message.before.slice(-200)}`,{k:5}).catch(()=>[]),new Promise<[]>(r=>setTimeout(()=>r([]),2500))]),
  asksAboutNow(message.instruction)?heardJustNow():Promise.resolve(undefined),
  lately(url),
  tabsBrief(url),
 ]);
 const memory=[...(heard?[heard]:[]),...found].map((m,i)=>({n:i+1,title:m.title,url:m.url,when:m.when,text:m.text}));
 const stable=inlineStable({...message,facts:settings.facts,style:recall.style});
 const fresh=inlineFresh({instruction:message.instruction,now:new Date(),timeZone:timeZone(),memory,previous:message.previous,lately:latelyText(before)+(tabs?`\n<their_open_tabs>\n${tabs}\n</their_open_tabs>`:'')});
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
  await model({model:settings.models.inline,system:INLINE_SYSTEM,messages:[{role:'user',content:[{type:'text',text:stable,cache_control:{type:'ephemeral'}},{type:'text',text:fresh}]}],max_tokens:room,purpose:'inline'},{signal,onEvent:event=>{
   if(event.data?.type!=='content_block_delta'||event.data.delta?.type!=='text_delta')return;
   raw+=event.data.delta.text;const body=parse(false);
   if(body!==null&&mode!=='act'&&body!==sent){sent=body;send({type:'inline.text',id:message.id,mode,text:shape(body,message),final:false});}
  }});
 }catch(error){if(signal.aborted)return;send({type:'inline.text',id:message.id,mode:mode??'answer',text:'',final:true,error:(error as Error).message});return;}
 const body=parse(true)??'';
 if(mode==='act'){const action=actionOf(body);send({type:'inline.text',id:message.id,mode:action?'act':'answer',text:action?action.label:'That could not be turned into an action.',action,final:true});return;}
 send({type:'inline.text',id:message.id,mode,text:shape(body,message),final:true,sources:mode==='answer'?memory.map(m=>({n:m.n,title:m.title,url:m.url})):undefined});
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
