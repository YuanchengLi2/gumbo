import {on} from './surfaces';
import {model} from './model';
import {add} from './db';
import {invalidate} from './recall';
import {searchMemory} from './search';
import {loadSettings,activeOn,siteOf} from '../shared/settings';
import {INLINE_SYSTEM,inlineStable,inlineFresh} from '../shared/prompts';
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
 const stable=inlineStable({...message,facts:settings.facts}),key=stable.slice(0,300)+stable.length;
 if(Date.now()-(warmed.get(key)??0)<240_000)return;warmed.set(key,Date.now());if(warmed.size>100)warmed.delete(warmed.keys().next().value!);
 await model({model:settings.models.inline,system:INLINE_SYSTEM,messages:[{role:'user',content:[{type:'text',text:stable,cache_control:{type:'ephemeral'}},{type:'text',text:'.'}]}],max_tokens:0,stream:false,purpose:'prewarm'}).catch(()=>{});
});

on('inline',async(message:Ask,{send,signal,url})=>{
 const settings=await loadSettings();
 if(!activeOn(settings,siteOf(url)||message.site)){send({type:'inline.text',id:message.id,mode:'answer',text:'Gumbo is off on this site.',final:true});return;}
 const found=await searchMemory(`${message.instruction} ${message.selection.slice(0,300)}`,{k:5});
 const memory=found.map((f,i)=>({n:i+1,title:f.title,url:f.url,when:new Date(f.at).toLocaleDateString('en-US',{month:'short',day:'numeric'}),text:f.text}));
 const stable=inlineStable({...message,facts:settings.facts});
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
