import {on} from './surfaces';
import {model} from './model';
import {add,putSealed,getSealed,recent} from './db';
import {loadSettings,activeOn,siteOf,blockedSite} from '../shared/settings';
import {Learner,pageKindOf,clickKey,type Step,type Candidate} from '../shared/learn';
/** Tab for actions in the engine. Every click a page reports and every page a tab opens becomes a step; the learner counts
 * which step follows which, on which kind of page, at what hour. When a page asks what comes next, the candidates are
 * the steps that usually follow the user's last one there: a strong habit is offered as it is; otherwise Haiku picks
 * one of the candidates (or none) and words it, and it can never offer a step that is not one of them. All of it is
 * sealed in memory like everything else. */
let learner:Learner|undefined,loading:Promise<Learner>|undefined,saveTimer:ReturnType<typeof setTimeout>|undefined;
const last=new Map<number,Step>(),decided=new Map<string,{at:number;pick:Candidate|null;label?:string}>();
async function brain(){
 if(learner)return learner;
 return loading??=(async()=>{try{learner=Learner.from(await getSealed('learner'));}catch{learner=new Learner();}loading=undefined;return learner;})();
}
function save(){clearTimeout(saveTimer);saveTimer=setTimeout(()=>{if(learner)void putSealed('learner',learner.toJSON()).catch(()=>{});},4000);}
async function allowed(url:string){const settings=await loadSettings();return /^https?:/.test(url)&&activeOn(settings,siteOf(url));}
/** The last step in a tab, if recent enough to lead to the next one. */
const previous=(tab:number,now:number)=>{const step=last.get(tab);return step&&now-step.at<30*60_000?step:undefined;};

export async function observe(tab:number,step:Step){
 const l=await brain();l.observe(previous(tab,step.at),step);last.set(tab,step);save();
 void add('events',{site:siteOf(step.url??''),pageKind:step.pageKind,url:step.url??'',kind:step.kind==='click'?'click':'navigate',role:step.target?.role??'',name:step.target?.name??step.label,path:step.target?.path,nearby:step.target?.nearby,title:step.title,at:step.at,source:'browser'}).catch(()=>{});
}
on('capture.event',async(message:{role:string;name:string;path?:string;nearby?:string},{url,port})=>{
 const tab=port.sender?.tab?.id;if(tab===undefined||port.sender?.tab?.incognito||!await allowed(url)||!message.name)return;
 await observe(tab,{kind:'click',pageKind:pageKindOf(url),key:clickKey(message.role,message.name),label:message.name,target:{role:message.role,name:message.name,path:message.path,nearby:message.nearby},url,title:port.sender?.tab?.title,at:Date.now()});
});
chrome.tabs.onUpdated.addListener((tab,change,info)=>{
 if(!change.url||info.incognito)return;
 void allowed(change.url).then(ok=>{if(!ok)return;const kind=pageKindOf(change.url!);
  // The same kind of page again (a route change inside it) is not a new step.
  if(last.get(tab)?.kind==='navigate'&&last.get(tab)?.pageKind===kind)return;
  void observe(tab,{kind:'navigate',pageKind:kind,key:'nav:'+kind,label:info.title||change.url!,url:change.url,title:info.title,at:Date.now()});});
});
chrome.tabs.onRemoved.addListener(tab=>last.delete(tab));

/** What comes next on this page, if Gumbo is sure enough to offer it. */
on('actions.next',async(message:{id:string;title:string;headings?:string[]},{send,url,port})=>{
 const tab=port.sender?.tab?.id,answer=(pick:Candidate|null,label?:string)=>send({type:'actions.next',id:message.id,step:pick?.step,label:label??pick?.step.label,strong:pick?.strong,why:pick?.why});
 if(tab===undefined||!await allowed(url)){answer(null);return;}
 const l=await brain(),now=Date.now(),prev=previous(tab,now),pageKind=pageKindOf(url);
 const found=l.candidates({pageKind,prev,now}).filter(c=>!(c.step.kind==='navigate'&&c.step.pageKind===pageKind)&&c.p>=0.25&&!blockedSite(siteOf(c.step.url??url)));
 if(!found.length){answer(null);return;}
 if(found[0].strong){answer(found[0]);return;}
 // Asked once per page and step for a few minutes: the same question gets the same answer without a model call.
 const key=`${pageKind}|${prev?.key??'start'}`,cached=decided.get(key);
 if(cached&&now-cached.at<5*60_000){answer(cached.pick,cached.label);return;}
 const settings=await loadSettings();
 const list=found.map((c,i)=>`${i+1}. ${c.step.kind==='navigate'?`Open ${c.step.title||c.step.label} (${c.step.url})`:`Click "${c.step.label}"${c.step.target?.nearby?` (near "${c.step.target.nearby.slice(0,60)}")`:''}`} — taken ${c.why}`).join('\n');
 try{
  const {message:reply}=await model({model:settings.models.action,system:'You decide whether to offer a person their likely next step in the browser as a one-tap suggestion. Offer one only when it is clearly what they usually do next here. Reply with the number of the step and a short label (at most 6 words, an imperative like "Open the gateway logs"), as: 2 | Open the gateway logs. Reply 0 when none is clearly next.',messages:[{role:'user',content:`They are on: ${message.title} (${url})\nIts headings: ${(message.headings??[]).slice(0,8).join(' · ')}\nTheir last step: ${prev?.label??'opened this page'}\nWhat they usually do next here:\n${list}`}],max_tokens:30,purpose:'action',stream:false});
  const text=(reply?.content??[]).map((b:any)=>b.text??'').join('').trim(),m=/^(\d+)\s*\|\s*(.{2,60})$/m.exec(text);
  const pick=m&&Number(m[1])>=1&&Number(m[1])<=found.length?found[Number(m[1])-1]:null,label=m?.[2]?.trim();
  decided.set(key,{at:now,pick,label});if(decided.size>300)decided.delete(decided.keys().next().value!);
  answer(pick,label);
 }catch{answer(null);}
});
/** Runs a step the page cannot run itself: opening a page in this tab. */
on('actions.open',async(message:{url:string},{port,send})=>{const tab=port.sender?.tab?.id;if(tab!==undefined&&/^https?:/.test(message.url))await chrome.tabs.update(tab,{url:message.url});send({type:'actions.opened'});});
on('actions.outcome',async(message:{label:string;outcome:'accepted'|'dismissed'|'ignored'},{url})=>{
 try{await add('suggestions',{site:siteOf(url),intent:'action',kind:'action',text:message.label,accepted:message.outcome==='accepted'?1:0,outcome:message.outcome,at:Date.now()});}catch{}
});

/** The user's own steps, replayed: how often a chip would have shown, and how often it was right. */
export async function measureActions(){
 const events=(await recent('events',20_000)).reverse();
 const steps:Step[]=events.map(e=>e.kind==='click'?{kind:'click',pageKind:e.pageKind,key:clickKey(e.role,e.name),label:e.name,at:e.at}:{kind:'navigate',pageKind:e.pageKind,key:'nav:'+e.pageKind,label:e.title??e.url,url:e.url,at:e.at});
 return Learner.meter(steps);
}
export {brain};
