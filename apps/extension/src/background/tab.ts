import {on} from './surfaces';
import {model} from './model';
import {recallFor,invalidate} from './recall';
import {add,addTiming,recent,suggestionOutcomes} from './db';
import {loadSettings,activeOn,siteOf} from '../shared/settings';
import {tabRequest,stableContext,LEAN_TAB_SYSTEM,emptyRecall} from '../shared/prompts';
import {cleanSuggestion,lastWordOf,alternativesOf} from '../shared/suggestion';
import type {FieldContext} from '../content/context';
import {fieldKey,fieldQuery,writingQuery} from './memory-context';
import {lately} from './memory/live';
import {getContext,type Bundle} from './memory/context';
import {config} from './memory/config';
import {thrifty} from './thrift';
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
/** The model Tab falls back to when its own fails. */
const FALLBACK='claude-haiku-5-5';
/** A memory item as the user would name it (the bundle words items for the model: "they wrote in …"). */
function shownAs(item:Bundle['items'][number]){
 const site=(()=>{try{return new URL(item.url??'').hostname.replace(/^www\./,'');}catch{return '';}})();
 return item.kind==='wrote'||item.kind==='writing'?`what you wrote${site?` on ${site}`:''}`:item.kind==='copy'?'what you copied':item.title;
}
/** A part of Tab's context, or what stands in for it when it has not come in time (and a note of what was slow). */
function within<T>(part:Promise<T>,fallback:T,what:string,site:string,ms=250):Promise<T>{
 let late=false;
 const timer=new Promise<T>(r=>setTimeout(()=>{late=true;r(fallback);},ms));
 void part.then(()=>{if(late)void add('failures',{site,editor:'',what:'context',detail:`Tab text: ${what} took over ${ms} ms`,at:Date.now()}).catch(()=>{});},error=>{void add('failures',{site,editor:'',what:'context',detail:`Tab text: ${what} failed: ${(error as Error)?.message}`,at:Date.now()}).catch(()=>{});});
 return Promise.race([part.catch(()=>fallback),timer]);
}
const lastBundle=new Map<string,Bundle>();
const noBundle=():Bundle=>({surface:'tab-text',at:Date.now(),ms:0,query:'',stable:'',fresh:'',items:[],known:'',searching:true,blocks:{page:'',browser:'',session:'',memory:'',map:''}});
/** Where a fact in a suggestion came from: the first memory item that holds a fact the page and the field do not. */
function sourceOf(text:string,bundle:Bundle,seen:string){
 // Facts only: an email, a link, a number or time, a capitalised name inside a sentence (never any word: a plain word in
 // a memory item is not where a suggestion came from).
 const facts=text.match(/[\w.+-]+@[\w-]+\.[\w.-]+|https?:\/\/\S+|\d[\d,.:/-]*\s?(?:[AaPp][Mm])?|(?<=[\p{Ll}\p{N},;:]\s+)\p{Lu}[\p{L}'-]{2,}/gu)??[];
 const here=seen.toLowerCase();
 for(const f of facts){const bare=f.toLowerCase().replace(/[.,;:!?)]+$/,'').trim();if(bare.length<2||here.includes(bare))continue;const item=bundle.items.find(i=>`${i.title} ${i.text}`.toLowerCase().includes(bare));if(item)return{title:shownAs(item).slice(0,60),when:item.when,id:item.id};}
}
on('tab',async(message:Ask,{send,signal,url,tabId:tab})=>{
 const started=performance.now(),settings=await loadSettings(),site=siteOf(url)||message.context.site;
 if(!activeOn(settings,site)){send({type:'tab.text',id:message.id,text:'',final:true});return;}
 // A search box is one line, whatever the page made it of (Google's is a textarea).
 // An empty field is asked about before they type a word: saving credits (thrift.ts), it waits for their first word.
 if(!message.before.trim()&&!message.after.trim()&&await thrifty()){send({type:'tab.text',id:message.id,text:'',final:true});return;}
 const c={...message.context,singleLine:message.context.singleLine||message.context.intent==='search'},cfg=(await config()).text;
 // The memory every surface has, for this field and what is being written now (its search kept per field and refreshed
 // behind it as the writing moves on); the user's own writing in this kind of field, for their voice.
 // Each part is waited for 600 ms at most: memory that is slow (or stuck) never silences Tab; it writes from the field and
 // the page alone, and what was slow is kept as a failure for the debug page.
 // Memory that is slow this once stands in with what this field had last (never with nothing: a request with no memory
 // is a guess at the very fact memory holds).
 const key=fieldKey(site,c.intent,c.label,c.thread);
 const [recall,bundle,before]=await Promise.all([
  within(recallFor({site,intent:c.intent,before:message.before,thread:c.thread?.slice(-2).map(m=>m.text).join('\n'),current:message.text}),emptyRecall(),'recall',site),
  within(getContext({surface:'tab-text',tab,url:c.url,query:fieldQuery({title:c.title,label:c.label,thread:c.thread,headings:c.headings,around:c.around,sentence:writingQuery(message.before)}),field:{intent:c.intent,label:c.label},budget:1200,key}).then(b=>{lastBundle.set(key,b);if(lastBundle.size>100)lastBundle.delete(lastBundle.keys().next().value!);return b;}),lastBundle.get(key)??noBundle(),'getContext',site,400),
  within(lately(c.url),undefined,'lately',site),
 ]);
 if(signal.aborted)return;
 recall.copied=(before?.copied??[]).filter(x=>Date.now()-x.at<5*60_000).map(x=>({title:x.title,text:x.text}));
 const contextMs=performance.now()-started;
 // A search box gets what they read and wrote before (the product in the review they just read), never the screens of
 // their tabs: those put the screen's words in the box instead of what was being typed.
 const {system,messages,known}=tabRequest(c,message.before,message.after,recall,c.intent==='search'?{...bundle,fresh:bundle.blocks.memory}:bundle,LEAN_TAB_SYSTEM);
 // Asked for what comes after its own suggestion: the model is told so, and judges whether the text is now whole.
 if(message.chain)(messages[0].content as any[]).push({type:'text',text:'The last words before the cursor are your own suggestion, which they are taking. Judge the whole text as it stands: if it already says what they want (a query that names what they are looking for, a message that makes its point), reply ∎ alone. Write more only if their thought plainly goes on.'});
 // An empty field, just entered: what goes in it, only when their context says it plainly.
 const empty=!message.before.trim()&&!message.after.trim();
 if(empty)(messages[0].content as any[]).push({type:'text',text:'The field is empty: they just clicked into it. Write what goes in it only when it is plain from what the field asks for (its label, the question or column it sits under) and a fact in their context (what they read, copied or have open): that value, exactly. Otherwise output nothing.'});
 const lastWord=lastWordOf(message.before),check=(raw:string,final:boolean)=>cleanSuggestion(raw,{before:message.before,after:message.after,singleLine:c.singleLine,known,final,lastWord,own:c.thread?.map(m=>m.text).join('\n')});
 // How sure the model is, as it says at the end of its reply (⟦7⟧: seven in ten), and the reply without it.
 const sureOf=(raw:string)=>{const m=/⟦(\d)⟧/.exec(raw);return m?Math.min(0.95,Number(m[1])/10):undefined;},bare=(raw:string)=>raw.replace(/⟦\d?⟧?|⟦$/g,'');
 let raw='',shown='',firstMs:number|undefined;const asked=performance.now();
 try{
  const ask=(id:string)=>model({model:id,system,messages,max_tokens:(c.singleLine?cfg.maxTokensSingle:cfg.maxTokensMulti)+(cfg.alternatives>1?40:0),purpose:'tab'},{signal,onEvent:event=>{
   if(event.data?.type!=='content_block_delta'||event.data.delta?.type!=='text_delta')return;
   firstMs??=performance.now()-asked;raw+=event.data.delta.text;
   // The best one shows as it streams (whole words only); the alternatives come with the final answer.
   const [best,...more]=alternativesOf(bare(raw).replace(/∎/g,'')),text=check(best,more.length>0);
   // An empty field's answer waits until it is whole: it shows only if a fact turns out to be behind it.
   if(!empty&&text.length>shown.length){shown=text;send({type:'tab.text',id:message.id,text,final:false});}
  }});
  // Tab's model failing before it wrote anything (its provider down, a limit reached): Haiku answers the same request.
  const {message:reply,timing}=await ask(settings.models.tab).catch(error=>{if(signal.aborted||raw||settings.models.tab===FALLBACK)throw error;return ask(FALLBACK);});
  if(signal.aborted)return;
  // ∎ after the best: the text is finished once it is typed (alone: it already is). The next step is then a move.
  const said=raw||(reply?.content??[]).map((b:any)=>b.text??'').join(''),confidence=sureOf(said),full=bare(said),done=(full.split('⟂')[0]??'').includes('∎');
  const [best='',...more]=alternativesOf(full.replace(/∎/g,''));
  // The ⟂ between ways to go on takes the space around it: each alternative starts where the best one does (after a
  // whole word, with its space), so taking one never glues it to the word before.
  const lead=/^\s*/.exec(best)?.[0]??'';
  const checked=check(best,true),alternatives=more.map(a=>check(/^\s/.test(a)?a:lead+a,true)).filter(a=>a&&a!==checked).slice(0,Math.max(0,cfg.alternatives-1));
  const source=checked?sourceOf(checked,bundle,`${message.before}\n${message.after}\n${c.label}\n${(c.around??[]).join('\n')}\n${(c.thread??[]).map(m=>m.text).join('\n')}\n${(c.form??[]).map(f=>f.value).join('\n')}`):undefined;
  // In an empty field, words with no fact from their context behind them are a guess at what someone might type there:
  // shown only when the model is sure.
  const text=empty&&!source&&(confidence??0)<0.8?'':checked;
  const split={context:Math.round(contextMs),firstToken:firstMs===undefined?undefined:Math.round(firstMs),gateway:timing?.provider,total:Math.round(performance.now()-started)};
  void addTiming({surface:message.chain?'tab-chain':'tab-model',ms:split.total,gateway:timing,at:Date.now()});
  send({type:'tab.text',id:message.id,text,alternatives:text?alternatives:[],final:true,done,source,confidence,used:bundle.items.filter(i=>i.layer==='past').slice(0,4).map(i=>i.id),split});
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
 const [recall,bundle]=await Promise.all([recallFor({site,intent:c.intent,before:''}),getContext({surface:'tab-text',tab:undefined,url:c.url,query:fieldQuery({title:c.title,label:c.label,thread:c.thread,headings:c.headings,around:c.around}),field:{intent:c.intent,label:c.label},budget:1600,key:fieldKey(site,c.intent,c.label,c.thread),wait:0})]);
 const stable=(bundle.stable?bundle.stable+'\n':'')+stableContext(message.context,{...recall,facts:{}}),key=`${settings.models.tab}|${stable.length}|${stable.slice(0,400)}`;
 if(Date.now()-(warmed.get(key)??0)<240_000)return;warmed.set(key,Date.now());
 if(warmed.size>200)warmed.delete(warmed.keys().next().value!);
 await model({model:settings.models.tab,system:LEAN_TAB_SYSTEM,messages:[{role:'user',content:[{type:'text',text:stable||'<field>\nA text field.\n</field>',cache_control:{type:'ephemeral'}},{type:'text',text:'.'}]}],max_tokens:0,stream:false,purpose:'prewarm'}).catch(()=>{});
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
