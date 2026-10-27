import {on} from './surfaces';
import {add,putSealed,getSealed,recent,type ActionEvent} from './db';
import {loadSettings,activeOn,siteOf} from '../shared/settings';
import {Learner,pageKindOf,clickKey,type Step,type Candidate} from '../shared/learn';
import {noteStep,recordEvent,current} from './memory/live';
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
/** The tab's last step (for the predictor's habits). */
export const lastStep=(tab:number)=>previous(tab,Date.now());
/** The step before the tab's last one (for sequences: A → B → C). */
const before=new Map<number,Step>();
export const stepBefore=(tab:number)=>{const step=before.get(tab);return step&&Date.now()-step.at<30*60_000?step:undefined;};

export async function observe(tab:number,step:Step){
 const l=await brain(),prev=previous(tab,step.at),prev2=prev?stepBefore(tab):undefined;
 l.observe(prev,step,prev2);if(prev)before.set(tab,prev);last.set(tab,step);save();
 void recordEvent(tab,{site:siteOf(step.url??''),pageKind:step.pageKind,url:step.url??'',kind:step.kind==='click'?'click':'navigate',role:step.target?.role??'',name:step.target?.name??step.label,path:step.target?.path,nearby:step.target?.nearby,title:step.title,at:step.at});
}
/** The steps a page reports, in its words (content/predict.ts did()), as kinds of event. Typing is an event the first
 * time in a field on a page (what was typed is writing, never an event); being somewhere, or Tab's own outcomes, are not
 * events. */
const kinds:Record<string,ActionEvent['kind']>={clicked:'click','double-clicked':'click','right-clicked':'click','clicked on the drawing':'click',chose:'select',set:'select',checked:'check',unchecked:'check','pasted into':'paste',dragged:'drag','opened a dialog':'dialog',typed:'type'};
/** Something the user did on a page: the tab's trail (the top page's own steps), the habits (clicks, by what they touched),
 * and the event log (everything, chained). learn: a click Tab made for them, which habits count but the trail already has
 * (as what Tab took). */
on('event',async(m:{kind:string;label:string;text?:string;title:string;role?:string;name?:string;path?:string;nearby?:string;value?:string;learn?:boolean},{url,port})=>{
 const tab=port.sender?.tab?.id;if(tab===undefined||port.sender?.tab?.incognito||!await allowed(url))return;
 const now=Date.now(),pageKind=pageKindOf(url);
 if(!port.sender?.frameId&&!m.learn)await noteStep(tab,url,m);
 if(m.kind==='clicked'&&m.role&&m.name){await observe(tab,{kind:'click',pageKind,key:clickKey(m.role,m.name),label:m.name,target:{role:m.role,name:m.name,path:m.path,nearby:m.nearby},url,title:port.sender?.tab?.title,at:now});return;}
 const kind=kinds[m.kind];if(!kind||m.learn)return;
 if(kind==='type'){const v=await current(tab);if(!v)return;const field=m.label.slice(0,80);if((v.typedIn??=[]).includes(field))return;v.typedIn.push(field);}
 void recordEvent(tab,{site:siteOf(url),pageKind,url,kind,role:m.role??'',name:(m.name??m.label).slice(0,120),path:m.path,nearby:m.nearby,title:port.sender?.tab?.title,value:kind==='select'||kind==='check'?(m.value??m.text)?.slice(0,80):undefined,at:now});
});
chrome.tabs.onUpdated.addListener((tab,change,info)=>{
 if(!change.url||info.incognito)return;
 void allowed(change.url).then(ok=>{if(!ok)return;const kind=pageKindOf(change.url!);
  // The same kind of page again (a route change inside it) is not a new step.
  if(last.get(tab)?.kind==='navigate'&&last.get(tab)?.pageKind===kind)return;
  void observe(tab,{kind:'navigate',pageKind:kind,key:'nav:'+kind,label:info.title||change.url!,url:change.url,title:info.title,at:Date.now()});});
});
chrome.tabs.onRemoved.addListener(tab=>last.delete(tab));

/** Runs a step the page cannot run itself: opening a page in this tab. */
on('actions.open',async(message:{url:string},{port,send})=>{const tab=port.sender?.tab?.id;if(tab!==undefined&&/^https?:/.test(message.url))await chrome.tabs.update(tab,{url:message.url});send({type:'actions.opened'});});
/** A Tab move that leaves the page (a link, an address, back): the next page offers Undo for a few seconds, which goes
 * back in the tab. */
const leaving=new Map<number,{label:string;from:string;at:number}>();
on('undo.note',(m:{label:string},{port,url})=>{const tab=port.sender?.tab?.id;if(tab!==undefined&&!port.sender?.frameId)leaving.set(tab,{label:m.label.slice(0,60),from:url,at:Date.now()});});
on('undo.pending',(_m:unknown,{port,send,url})=>{
 const tab=port.sender?.tab?.id,l=tab!==undefined?leaving.get(tab):undefined;
 const fresh=!!l&&Date.now()-l.at<8000&&l.from!==url&&!port.sender?.frameId;if(fresh)leaving.delete(tab!);
 send({type:'undo.pending',label:fresh?l!.label:undefined});
});
on('undo.back',async(_m:unknown,{port})=>{const tab=port.sender?.tab?.id;if(tab!==undefined)await chrome.tabs.goBack(tab).catch(()=>{});});
on('actions.outcome',async(message:{label:string;outcome:'accepted'|'dismissed'|'ignored'|'undone'},{url})=>{
 try{await add('suggestions',{site:siteOf(url),intent:'action',kind:'action',text:message.label,accepted:message.outcome==='accepted'?1:0,outcome:message.outcome,at:Date.now()});}catch{}
});

/** The user's own steps, replayed: how often a chip would have shown, and how often it was right. */
export async function measureActions(){
 const events=(await recent('events',20_000)).reverse();
 const steps:Step[]=events.map(e=>e.kind==='click'?{kind:'click',pageKind:e.pageKind,key:clickKey(e.role,e.name),label:e.name,at:e.at}:{kind:'navigate',pageKind:e.pageKind,key:'nav:'+e.pageKind,label:e.title??e.url,url:e.url,at:e.at});
 return Learner.meter(steps);
}
export {brain};
