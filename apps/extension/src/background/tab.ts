import {on} from './surfaces';
import {model} from './model';
import {recallFor,invalidate} from './recall';
import {add,addTiming,recent,suggestionOutcomes} from './db';
import {loadSettings,activeOn,siteOf} from '../shared/settings';
import {tabRequest,stableContext,TAB_SYSTEM} from '../shared/prompts';
import {cleanSuggestion,lastWordOf,alternativesOf} from '../shared/suggestion';
import type {FieldContext} from '../content/context';
import {fieldKey,fieldQuery,writingQuery} from './memory-context';
import {lately} from './memory/live';
import {getContext,type Bundle} from './memory/context';
import {config} from './memory/config';
/** Tab in the engine: a page asks with the field's context and the text around the caret, and gets back, streaming, what
 * comes next. One run of the model, written in the user's voice from the memory every surface has (memory/context.ts:
 * who they are and how they write here, what they are working on, this session, the past), as long as it can see clearly
 * (up to three sentences, the rest of the line in a one-line field), with up to two shorter alternatives that go another
 * way, so the page can switch to the one the user's typing still matches. It passes the suggestion checks a whole word at
 * a time. A fact it took from memory (a name, a time, a link not in the field or on the page) comes with where it came
 * from, so a wrong one is easy to see. Each answer reports how long its parts took (memory, the gateway and the model's
 * first word) and what it cost. chain: asked for what comes after a suggestion not yet taken (the page keeps it ready). */
type Ask={id:string;context:FieldContext;before:string;after:string;text:string;chain?:boolean};
const warmed=new Map<string,number>();
/** Where a fact in a suggestion came from: the first memory item that holds a fact the page and the field do not. */
function sourceOf(text:string,bundle:Bundle,seen:string){
 const facts=text.match(/[\w.+-]+@[\w-]+\.[\w.-]+|https?:\/\/\S+|\d[\d,.:/-]*\s?(?:am|pm)?|(?<=\S\s+)\p{Lu}[\p{L}'-]{2,}/giu)??[];
 const here=seen.toLowerCase();
 for(const f of facts){const bare=f.toLowerCase().replace(/[.,;:!?)]+$/,'').trim();if(bare.length<2||here.includes(bare))continue;const item=bundle.items.find(i=>`${i.title} ${i.text}`.toLowerCase().includes(bare));if(item)return{title:item.title.slice(0,60),when:item.when,id:item.id};}
}
on('tab',async(message:Ask,{send,signal,url,tabId:tab})=>{
 const started=performance.now(),settings=await loadSettings(),site=siteOf(url)||message.context.site;
 if(!activeOn(settings,site)){send({type:'tab.text',id:message.id,text:'',final:true});return;}
 const c=message.context,cfg=(await config()).text;
 // The memory every surface has, for this field and what is being written now (its search kept per field and refreshed
 // behind it as the writing moves on); the user's own writing in this kind of field, for their voice.
 const [recall,bundle,before]=await Promise.all([
  recallFor({site,intent:c.intent,before:message.before,thread:c.thread?.slice(-2).map(m=>m.text).join('\n'),current:message.text}),
  getContext({surface:'tab-text',tab,url:c.url,query:fieldQuery({title:c.title,label:c.label,thread:c.thread,headings:c.headings,sentence:writingQuery(message.before)}),field:{intent:c.intent,label:c.label},budget:1600,key:fieldKey(site,c.intent,c.label,c.thread)}),
  lately(c.url),
 ]);
 recall.copied=before.copied.filter(x=>Date.now()-x.at<5*60_000).map(x=>({title:x.title,text:x.text}));
 const contextMs=performance.now()-started;
 const {system,messages,known}=tabRequest(c,message.before,message.after,recall,bundle);
 const lastWord=lastWordOf(message.before),check=(raw:string,final:boolean)=>cleanSuggestion(raw,{before:message.before,after:message.after,singleLine:c.singleLine,known,final,lastWord,own:c.thread?.map(m=>m.text).join('\n')});
 let raw='',shown='',firstMs:number|undefined;const asked=performance.now();
 try{
  const {message:reply,timing}=await model({model:settings.models.tab,system,messages,max_tokens:(c.singleLine?cfg.maxTokensSingle:cfg.maxTokensMulti)+(cfg.alternatives>1?40:0),purpose:'tab'},{signal,onEvent:event=>{
   if(event.data?.type!=='content_block_delta'||event.data.delta?.type!=='text_delta')return;
   firstMs??=performance.now()-asked;raw+=event.data.delta.text;
   // The best one shows as it streams (whole words only); the alternatives come with the final answer.
   const [best,...more]=alternativesOf(raw),text=check(best,more.length>0);
   if(text.length>shown.length){shown=text;send({type:'tab.text',id:message.id,text,final:false});}
  }});
  if(signal.aborted)return;
  const [best='',...more]=alternativesOf(raw||(reply?.content??[]).map((b:any)=>b.text??'').join(''));
  const text=check(best,true),alternatives=more.map(a=>check(a,true)).filter(a=>a&&a!==text).slice(0,Math.max(0,cfg.alternatives-1));
  const source=text?sourceOf(text,bundle,`${message.before}\n${message.after}\n${c.label}\n${c.page??''}\n${(c.thread??[]).map(m=>m.text).join('\n')}\n${(c.form??[]).map(f=>f.value).join('\n')}`):undefined;
  const split={context:Math.round(contextMs),firstToken:firstMs===undefined?undefined:Math.round(firstMs),gateway:timing?.provider,total:Math.round(performance.now()-started)};
  void addTiming({surface:message.chain?'tab-chain':'tab-model',ms:split.total,gateway:timing,at:Date.now()});
  send({type:'tab.text',id:message.id,text,alternatives,final:true,source,used:bundle.items.filter(i=>i.layer==='past').slice(0,4).map(i=>i.id),split});
 }catch(error){if(!signal.aborted)send({type:'tab.text',id:message.id,text:'',final:true,error:(error as Error).message});}
});

/** Warms the model's cache for a field the user just focused: the instructions and everything about the field that will
 * not change while they type there. At most once every four minutes per field kind and site, within the cache's five. */
on('tab.prewarm',async(message:{context:FieldContext},{url})=>{
 const settings=await loadSettings(),site=siteOf(url)||message.context.site;
 if(!activeOn(settings,site))return;
 // The field's memory is searched now, so it is there when the first suggestion is asked for; and the part of the prompt
 // that stays the same while they type here is put in the provider's cache, exactly as tabRequest will send it.
 const c=message.context;
 const [recall,bundle]=await Promise.all([recallFor({site,intent:c.intent,before:''}),getContext({surface:'tab-text',tab:undefined,url:c.url,query:fieldQuery({title:c.title,label:c.label,thread:c.thread,headings:c.headings}),field:{intent:c.intent,label:c.label},budget:1600,key:fieldKey(site,c.intent,c.label,c.thread),wait:0})]);
 const stable=(bundle.stable?bundle.stable+'\n':'')+stableContext(message.context,{...recall,facts:{}}),key=`${settings.models.tab}|${stable.length}|${stable.slice(0,400)}`;
 if(Date.now()-(warmed.get(key)??0)<240_000)return;warmed.set(key,Date.now());
 if(warmed.size>200)warmed.delete(warmed.keys().next().value!);
 await model({model:settings.models.tab,system:TAB_SYSTEM,messages:[{role:'user',content:[{type:'text',text:stable||'<field>\nA text field.\n</field>',cache_control:{type:'ephemeral'}},{type:'text',text:'.'}]}],max_tokens:0,stream:false,purpose:'prewarm'}).catch(()=>{});
});

/** How fast the first ghost word came, as the user saw it (from the pause in typing). */
on('tab.timing',async(message:{ms:number;from?:'cache'|'local'|'model';split?:Record<string,number|undefined>;render?:number})=>{
 if(message.ms>=0)await addTiming({surface:'tab',ms:message.ms,at:Date.now()});
 // Where the time went: memory, the model's first word (gateway and provider), and drawing it; and how it was served.
 if(message.from)await addTiming({surface:`tab-from-${message.from}`,ms:message.ms,at:Date.now()});
 for(const [part,ms] of Object.entries(message.split??{}))if(typeof ms==='number')await addTiming({surface:`tab-${part}`,ms,at:Date.now()});
 if(typeof message.render==='number')await addTiming({surface:'tab-render',ms:message.render,at:Date.now()});
});
/** What became of a suggestion: it teaches the site's threshold and gives examples of what this user takes. */
on('tab.outcome',async(message:{site:string;intent:string;kind:'text'|'action';text:string;accepted:number;outcome:'accepted'|'partial'|'ignored'|'dismissed';latencyMs?:number;used?:string[]})=>{
 try{await add('suggestions',{site:message.site,intent:message.intent,kind:message.kind,text:message.text.slice(0,400),accepted:message.accepted,outcome:message.outcome,latencyMs:message.latencyMs,at:Date.now(),used:message.used?.slice(0,8)});if(message.outcome!=='ignored')invalidate();}catch{}
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
  // Suggestions they rarely take come less often (after more words), never later: a pause is felt at once.
  return taken<0.08?{debounceMs:250,minWords:3}:taken<0.2?{debounceMs:150,minWords:2}:{debounceMs:120,minWords:1};
 }catch{return{debounceMs:120,minWords:1};}
}
export {suggestionOutcomes};
