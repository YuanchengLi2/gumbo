import {on} from './surfaces';
import {model} from './model';
import {recallFor,invalidate} from './recall';
import {add,addTiming,recent,suggestionOutcomes} from './db';
import {loadSettings,activeOn,siteOf} from '../shared/settings';
import {tabRequest,stableContext,TAB_SYSTEM} from '../shared/prompts';
import {cleanSuggestion,lastWordOf,agreed} from '../shared/suggestion';
import type {FieldContext} from '../content/context';
import {fieldMemory,fieldReady,fieldKey,fieldQuery,writingQuery} from './memory-context';
import {lately} from './lately';
/** Tab in the engine: a page asks with the field's context and the text around the caret; the answer streams back
 * through the suggestion checks a whole word at a time, and the model is stopped the moment the suggestion is complete
 * (a sentence ended), which saves both time and tokens. Focusing a field warms the model's cache with the part of the
 * prompt that stays the same while the user types there. */
type Ask={id:string;context:FieldContext;before:string;after:string;text:string};
const warmed=new Map<string,number>();

on('tab',async(message:Ask,{send,signal,url})=>{
 const settings=await loadSettings(),site=siteOf(url)||message.context.site;
 if(!activeOn(settings,site)){send({type:'tab.text',id:message.id,text:'',final:true});return;}
 const recall=await recallFor({site,intent:message.context.intent,before:message.before,thread:message.context.thread?.slice(-2).map(m=>m.text).join('\n'),current:message.text});
 // All of memory, always: what was found for this field (and its last sentence) is given at once; a newer search runs
 // behind it. Only the first suggestion in a field may wait, briefly, for the search its focus started.
 const c=message.context,key=fieldKey(site,c.intent,c.label,c.thread);
 recall.memory=fieldMemory(key,fieldQuery({title:c.title,label:c.label,thread:c.thread,headings:c.headings,sentence:writingQuery(message.before)}),c.url);
 if(!recall.memory.length)recall.memory=await fieldReady(key);
 // What they copied a few minutes ago, in any tab (held in the worker: no wait).
 recall.copied=(await lately(c.url)).copied.filter(x=>Date.now()-x.at<5*60_000).map(x=>({title:x.title,text:x.text}));
 const {system,messages,known}=tabRequest(message.context,message.before,message.after,recall);
 const lastWord=lastWordOf(message.before),check=(raw:string,final:boolean)=>cleanSuggestion(raw,{before:message.before,after:message.after,singleLine:message.context.singleLine,known,final,lastWord});
 // Two predictions run at once, and only the words both begin with are shown: where they part, the writer's next words
 // are not clear, and showing nothing there is better than a guess. They stop as soon as they part or a sentence ends.
 const runs=[{raw:'',done:false,failed:false},{raw:'',done:false,failed:false}],stop=new AbortController(),started=performance.now();let shown='';
 signal.addEventListener('abort',()=>stop.abort());
 const agreement=(final:boolean)=>{
  const alive=runs.filter(r=>!r.failed);
  if(!alive.length)return '';
  const [a,b]=alive.map(r=>check(r.raw,final||r.done));
  return b===undefined?a:agreed(a,b);
 };
 const step=()=>{
  const text=agreement(false);
  if(text.length>shown.length){shown=text;send({type:'tab.text',id:message.id,text,final:false});}
  // Both have gone past the words they share: nothing more will be agreed.
  const [a,b]=runs.map(r=>check(r.raw,false)),parted=!!a&&!!b&&a.length>text.length&&b.length>text.length&&!a.startsWith(b)&&!b.startsWith(a);
  if(runs.every(r=>r.done||r.failed)||parted)stop.abort();
 };
 const one=(run:typeof runs[number])=>model({model:settings.models.tab,system,messages,max_tokens:message.context.singleLine?24:40,purpose:'tab'},{signal:stop.signal,onEvent:event=>{
  if(event.data?.type!=='content_block_delta'||event.data.delta?.type!=='text_delta')return;
  run.raw+=event.data.delta.text;
  // A sentence (or a line) has ended: this prediction is complete.
  if(/[.!?…。！？]["”’)\]]?\s|\S\n/u.test(run.raw.trimStart()))run.done=true;
  step();
 }}).then(result=>{run.done=true;step();return result;},error=>{if(!stop.signal.aborted)run.failed=true;else run.done=true;step();throw error;});
 const settled=await Promise.allSettled(runs.map(one));
 if(signal.aborted)return;
 const ok=settled.find(s=>s.status==='fulfilled') as PromiseFulfilledResult<{timing:Record<string,number>}>|undefined;
 if(ok)void addTiming({surface:'tab-model',ms:performance.now()-started,gateway:ok.value.timing,at:Date.now()});
 if(runs.every(r=>r.failed)){const reason=(settled[0] as PromiseRejectedResult).reason;send({type:'tab.text',id:message.id,text:'',final:true,error:(reason as Error)?.message});return;}
 send({type:'tab.text',id:message.id,text:agreement(true),final:true});
});

/** Warms the model's cache for a field the user just focused: the instructions and everything about the field that will
 * not change while they type there. At most once every four minutes per field kind and site, within the cache's five. */
on('tab.prewarm',async(message:{context:FieldContext},{url})=>{
 const settings=await loadSettings(),site=siteOf(url)||message.context.site;
 if(!activeOn(settings,site))return;
 const recall=await recallFor({site,intent:message.context.intent,before:''});
 // The field's memory is searched now, so it is there when the first suggestion is asked for.
 const c=message.context;fieldMemory(fieldKey(site,c.intent,c.label,c.thread),fieldQuery({title:c.title,label:c.label,thread:c.thread,headings:c.headings}),c.url);
 const stable=stableContext(message.context,recall),key=`${settings.models.tab}|${stable.length}|${stable.slice(0,400)}`;
 if(Date.now()-(warmed.get(key)??0)<240_000)return;warmed.set(key,Date.now());
 if(warmed.size>200)warmed.delete(warmed.keys().next().value!);
 await model({model:settings.models.tab,system:TAB_SYSTEM,messages:[{role:'user',content:[{type:'text',text:stable||'<field>\nA text field.\n</field>',cache_control:{type:'ephemeral'}},{type:'text',text:'.'}]}],max_tokens:0,stream:false,purpose:'prewarm'}).catch(()=>{});
});

/** How fast the first ghost word came, as the user saw it (from the pause in typing). */
on('tab.timing',async(message:{ms:number})=>{await addTiming({surface:'tab',ms:message.ms,at:Date.now()});});
/** What became of a suggestion: it teaches the site's threshold and gives examples of what this user takes. */
on('tab.outcome',async(message:{site:string;intent:string;kind:'text'|'action';text:string;accepted:number;outcome:'accepted'|'partial'|'ignored'|'dismissed';latencyMs?:number})=>{
 try{await add('suggestions',{site:message.site,intent:message.intent,kind:message.kind,text:message.text.slice(0,400),accepted:message.accepted,outcome:message.outcome,latencyMs:message.latencyMs,at:Date.now()});if(message.outcome!=='ignored')invalidate();}catch{}
});
/** Something that did not work, kept on this computer to fix the general mechanism. */
on('failure',async(message:{site:string;editor:string;what:'placement'|'insert'|'action'|'context'|'audio'|'model';detail:string})=>{
 try{await add('failures',{site:message.site,editor:message.editor,what:message.what,detail:String(message.detail).slice(0,500),at:Date.now()});}catch{}
});

/** How picky Tab is on a site: the more suggestions there are ignored, the longer the pause before one and the more it
 * must say; the more are taken, the readier it is. */
on('tab.bar',async(message:{site:string},{send})=>{send({type:'tab.bar',...await barFor(message.site)});});
export async function barFor(site:string):Promise<{debounceMs:number;minWords:number}>{
 try{
  const mine=(await recent('suggestions',60)).filter(s=>s.site===site&&s.kind==='text');
  if(mine.length<8)return{debounceMs:120,minWords:1};
  const taken=mine.filter(s=>s.outcome==='accepted'||s.outcome==='partial').length/mine.length;
  return taken<0.08?{debounceMs:600,minWords:3}:taken<0.2?{debounceMs:300,minWords:2}:{debounceMs:120,minWords:1};
 }catch{return{debounceMs:120,minWords:1};}
}
export {suggestionOutcomes};
