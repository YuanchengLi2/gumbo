import {useEffect,useLayoutEffect,useRef,useState,type ReactNode} from 'react';
import {ArrowDownUp,ArrowRightLeft,ArrowUp,ArrowUpRight,AtSign,Ban,Brain,CalendarDays,Check,ChevronRight,ChevronsUpDown,Copy,CornerDownLeft,CreditCard,Database,FileText,Globe,Hourglass,Keyboard,Lightbulb,ListTodo,LoaderCircle,Mail,MousePointerClick,PanelsTopLeft,RotateCcw,ScanText,ShieldCheck,Telescope,Triangle,X} from 'lucide-react';
import {Markdown,type Source} from './Markdown';
import {Favicon,KindIcon,host,ago,duration} from './ui';
import {post,listen,request} from './port';
import {stepWords} from '../shared/steps';
import type {Part,Turn,View,Found} from '../background/agent';
/** The agent in the sidebar. Each request reads as its work, then its answer, in the order it happened, as the best agent
 * panels show it (Cursor, ChatGPT's agent, Comet): thinking folds into "Thought for 4s"; reading and searching fold into
 * one "Explored" row with the sites' icons, while each click and keystroke has a row of its own (an icon, what, where,
 * how long), filled in from the model's arguments as they stream; a live look at the page shows where it is and what it
 * just touched; a step that can't be undone asks in a card (Enter allows, Esc denies); a plan ticks off; memory it used
 * shows as cards; the answer streams in smoothly and ends with its sources, how long it worked, and Copy. Messages sent
 * while it works wait their turn; Stop (or Esc) stops it. The view sticks to the newest line unless scrolled up. */
type Tool=Extract<Part,{kind:'tool'}>;
type ChatState={id:string;title:string;turns:Turn[];running:boolean;queued:number};
type TabInfo={id:number;title:string;url:string};
const web=(url?:string)=>/^https?:|^file:/.test(url??'');

export function Chat({chatId,onChat,seed,onSeeded}:{chatId?:string;onChat:(id?:string)=>void;seed?:string;onSeeded?:()=>void}){
 const [chat,setChat]=useState<ChatState>();const [views,setViews]=useState<Record<string,View>>({});
 const [draft,setDraft]=useState('');const [attached,setAttached]=useState<TabInfo[]>([]);const [here,setHere]=useState<TabInfo>();
 const [picker,setPicker]=useState<string|null>(null);
 const scroller=useRef<HTMLDivElement>(null),follow=useRef(true),input=useRef<HTMLTextAreaElement>(null);
 useEffect(()=>listen(m=>{
  if(m.type==='agent.chat'){if(!m.chat){setChat(undefined);return;}setChat({...m.chat,queued:m.chat.queued??0});if(m.chat.id!==chatId)onChat(m.chat.id);}
  if(m.type==='agent.turn')setChat(c=>{if(!c||c.id!==m.chat)return c;const turns=c.turns.slice(),i=turns.findIndex(t=>t.id===m.turn.id);if(i>=0)turns[i]=m.turn;else turns.push(m.turn);return{...c,turns,running:m.turn.status==='running'||c.queued>0};});
  if(m.type==='agent.done')setChat(c=>c&&c.id===m.chat?{...c,running:c.queued>0,queued:Math.max(0,c.queued-1)}:c);
  if(m.type==='agent.queued')setChat(c=>c&&c.id===m.chat?{...c,queued:m.queued}:c);
  if(m.type==='agent.view')setViews(v=>({...v,[m.turn]:m.view}));
 }),[chatId]);
 useEffect(()=>{if(chatId)post({type:'agent.open',chat:chatId});else{setChat(undefined);setViews({});}},[chatId]);
 // A running agent keeps the worker awake with a ping now and then.
 useEffect(()=>{if(!chat?.running)return;const t=setInterval(()=>post({type:'agent.ping'}),15_000);return()=>clearInterval(t);},[chat?.running]);
 // The page Gumbo would work in, kept current as the user moves between tabs.
 useEffect(()=>{
  const update=()=>void pageTab().then(t=>setHere(t?.id!==undefined&&web(t.url)?{id:t.id,title:t.title??'',url:t.url??''}:undefined));
  update();chrome.tabs.onActivated.addListener(update);const changed=(_id:number,change:{title?:string;url?:string})=>{if(change.title||change.url)update();};chrome.tabs.onUpdated.addListener(changed);
  return()=>{chrome.tabs.onActivated.removeListener(update);chrome.tabs.onUpdated.removeListener(changed);};
 },[]);
 useEffect(()=>{if(seed){setDraft(seed);onSeeded?.();input.current?.focus();}},[seed]);
 useLayoutEffect(()=>{const el=scroller.current;if(el&&follow.current)el.scrollTop=el.scrollHeight;});
 useEffect(()=>{input.current?.focus();},[chatId]);
 const waitingConfirm=chat?.turns.at(-1)?.parts.find(p=>p.kind==='confirm'&&p.status==='waiting') as Extract<Part,{kind:'confirm'}>|undefined;
 const answer=(yes:boolean)=>{if(chat&&waitingConfirm)post({type:'agent.confirm',chat:chat.id,id:waitingConfirm.id,yes});};
 // Enter allows a waiting step and Esc denies it, from anywhere in the panel (unless a message is being typed).
 useEffect(()=>{
  if(!waitingConfirm)return;
  const key=(e:KeyboardEvent)=>{if(draft.trim())return;if(e.key==='Enter'){e.preventDefault();answer(true);}if(e.key==='Escape'){e.preventDefault();answer(false);}};
  window.addEventListener('keydown',key,true);return()=>window.removeEventListener('keydown',key,true);
 },[waitingConfirm?.id,draft]);
 const send=async(text=draft)=>{
  const words=text.trim();if(!words)return;setDraft('');setPicker(null);follow.current=true;
  if(input.current)input.current.style.height='auto';
  post({type:'agent.send',chat:chat?.id,text:words,tabId:here?.id??(await pageTab())?.id,tabs:attached.map(t=>t.id)});setAttached([]);
 };
 const stop=()=>{if(chat)post({type:'agent.stop',chat:chat.id});};
 const onDraft=(value:string,caret:number)=>{
  setDraft(value);
  // "@" starts a mention: the open tabs show, filtered by what follows it.
  const before=value.slice(0,caret),at=/(?:^|\s)@([^\s@]*)$/.exec(before);setPicker(at?at[1]:null);
 };
 const pick=(tab:TabInfo)=>{
  setAttached(a=>a.some(t=>t.id===tab.id)?a:[...a,tab]);
  setDraft(d=>d.replace(/(^|\s)@[^\s@]*$/,'$1'));setPicker(null);input.current?.focus();
 };
 const last=chat?.turns.at(-1);
 return <section className="chat">
  <div className="turns" ref={scroller} onScroll={e=>{const el=e.currentTarget;follow.current=el.scrollHeight-el.scrollTop-el.clientHeight<48;}}>
   {!chat?.turns.length&&<Welcome here={here} ask={text=>void send(text)}/>}
   {chat?.turns.map(t=><TurnView key={t.id} turn={t} view={t===last?views[t.id]:undefined} chatId={chat.id} retry={()=>void send(t.user)}/>)}
   {!!chat?.queued&&<p className="queued"><Hourglass size={12}/>{chat.queued===1?'Your next message waits its turn':`${chat.queued} messages wait their turn`}</p>}
  </div>
  <div className="composer">
   {picker!==null&&<TabPicker query={picker} exclude={[here?.id,...attached.map(t=>t.id)]} pick={pick} close={()=>setPicker(null)}/>}
   <div className="chips">
    {here&&<span className="chip here" title={`Gumbo works in this page: ${here.url}`}><Favicon url={here.url} size={12}/><span>{here.title||host(here.url)}</span></span>}
    {attached.map(t=><span key={t.id} className="chip" title={t.url}><Favicon url={t.url} size={12}/><span>{t.title||host(t.url)}</span><button onClick={()=>setAttached(a=>a.filter(x=>x.id!==t.id))} title="Remove"><X size={11}/></button></span>)}
    <button className="chip add" onClick={()=>{setPicker('');input.current?.focus();}} title="Add other tabs (or type @)"><AtSign size={12}/><span>Tabs</span></button>
   </div>
   <textarea ref={input} rows={1} value={draft} placeholder={chat?.running?'Add to the queue…':'Ask, or tell Gumbo what to do'}
    onChange={e=>{onDraft(e.target.value,e.target.selectionStart);e.target.style.height='auto';e.target.style.height=Math.min(180,e.target.scrollHeight)+'px';}}
    onKeyDown={e=>{
     if(picker!==null&&['ArrowDown','ArrowUp','Enter','Tab'].includes(e.key))return;
     if(e.key==='Enter'&&!e.shiftKey&&!e.nativeEvent.isComposing){e.preventDefault();void send();}
     if(e.key==='Escape'){if(picker!==null){e.preventDefault();setPicker(null);}else if(chat?.running&&!waitingConfirm){e.preventDefault();stop();}}
    }}/>
   <div className="bar">
    <span className="hint">{chat?.running?<>Working · <kbd>Esc</kbd> stops</>:<><kbd>Enter</kbd> sends · <kbd>@</kbd> adds tabs</>}</span>
    {chat?.running&&!draft.trim()?<button className="stop" onClick={stop} title="Stop (Esc)"><span/></button>:<button className="send" disabled={!draft.trim()} onClick={()=>void send()} title="Send (Enter)"><ArrowUp size={15}/></button>}
   </div>
  </div>
 </section>;
}

/** The page the user means: the window's current tab, or, when that is one of Gumbo's own pages (the panel opened as a
 * tab), the web page they were on last. */
async function pageTab(){
 const [active]=await chrome.tabs.query({active:true,lastFocusedWindow:true});
 if(active&&web(active.url))return active;
 const tabs=await chrome.tabs.query({lastFocusedWindow:true});
 return tabs.filter(t=>web(t.url)).sort((a,b)=>(b.lastAccessed??0)-(a.lastAccessed??0))[0]??active;
}

/** Before the first message: what Gumbo sees, and things to ask, from the page and from what it remembers. */
function Welcome({here,ask}:{here?:TabInfo;ask:(text:string)=>void}){
 const [ideas,setIdeas]=useState<string[]>([]);
 useEffect(()=>{void request<{items:{kind:string;title:string;at:number}[]}>({type:'memory.recent'},'memory.recent').then(r=>{
  const out:string[]=[];
  const heard=r?.items.find(i=>i.kind==='media'&&Date.now()-i.at<3*86_400_000);if(heard)out.push(`What was decided in “${heard.title.slice(0,48)}”?`);
  const read=r?.items.find(i=>i.kind==='page'&&i.title!==here?.title);if(read)out.push(`Remind me what “${read.title.slice(0,48)}” said`);
  setIdeas(out);
 });},[here?.title]);
 // It knows the rest of the browser too (every tab, what was closed, today's trail): said here, so "that tab" is asked.
 const [others,setOthers]=useState(0);
 useEffect(()=>{void chrome.tabs.query({}).then(t=>setOthers(t.filter(x=>/^https?:/.test(x.url??'')&&x.url!==here?.url).length)).catch(()=>{});},[here?.url]);
 const pageIdeas=here?['Summarize this page','What matters most here?']:['What did I read today?'];
 if(others>=2)pageIdeas.push('What was I working on today?');
 return <div className="welcome">
  <h1>What can Gumbo do?</h1>
  <p className="lede">Ask about this page or anything you read, wrote or heard, or have Gumbo do it here. Steps that can't be undone wait for your OK.</p>
  {here&&<div className="sees"><span className="label">Sees</span><Favicon url={here.url} size={14}/><span className="title">{here.title||host(here.url)}</span><span className="site">{host(here.url)}</span></div>}
  {others>0&&<p className="knows">And your {others} other tab{others===1?'':'s'}, what you closed and today's history.</p>}
  <div className="ideas">{[...pageIdeas,...ideas].map(i=><button key={i} onClick={()=>ask(i)}><ArrowUpRight size={13}/><span>{i}</span></button>)}</div>
 </div>;
}

function TurnView({turn,view,chatId,retry}:{turn:Turn;view?:View;chatId:string;retry:()=>void}){
 const running=turn.status==='running';
 const todos=turn.parts.find(p=>p.kind==='todos') as Extract<Part,{kind:'todos'}>|undefined;
 // In order: thinking, words, steps (tools in a row form one block), questions; the words after the last step are the answer.
 let lastWork=-1;turn.parts.forEach((p,i)=>{if(p.kind!=='text'&&p.kind!=='todos'&&p.kind!=='memory')lastWork=i;});
 const memory=turn.parts.find(p=>p.kind==='memory') as Extract<Part,{kind:'memory'}>|undefined;
 type Block={type:'steps';tools:Tool[]}|{type:'text';part:Extract<Part,{kind:'text'}>;answer:boolean}|{type:'thinking';part:Extract<Part,{kind:'thinking'}>}|{type:'confirm';part:Extract<Part,{kind:'confirm'}>};
 const blocks:Block[]=[];
 turn.parts.forEach((p,i)=>{
  if(p.kind==='todos'||p.kind==='memory')return;
  if(p.kind==='tool'){const b=blocks.at(-1);if(b?.type==='steps')b.tools.push(p);else blocks.push({type:'steps',tools:[p]});return;}
  if(p.kind==='text'){if(p.text.trim())blocks.push({type:'text',part:p,answer:i>lastWork});return;}
  blocks.push({type:p.kind,part:p} as Block);
 });
 const answerText=blocks.filter(b=>b.type==='text'&&b.answer).map(b=>(b as any).part.text).join('\n\n');
 const cited=turn.sources.filter(s=>answerText.includes(`[${s.n}]`));
 let lastSteps=-1;blocks.forEach((b,i)=>{if(b.type==='steps')lastSteps=i;});
 const lastBlock=blocks.at(-1);
 return <article className={`ask ${turn.status}`}>
  <div className="you">
   <p>{turn.user}</p>
   {(turn.page||!!turn.tabs?.length)&&<div className="ctx">{turn.page&&<span className="chip" title={turn.page.url}><Favicon url={turn.page.url} size={11}/><span>{turn.page.title||host(turn.page.url)}</span></span>}{turn.tabs?.map(t=><span key={t.id} className="chip" title={t.url}><Favicon url={t.url} size={11}/><span>{t.title||host(t.url)}</span></span>)}</div>}
  </div>
  {memory&&<Remembered found={memory.items}/>}
  {todos&&<Plan items={todos.items} running={running}/>}
  {blocks.map((b,i)=>b.type==='steps'?<Steps key={i} tools={b.tools} running={running} view={i===lastSteps?view:undefined} page={turn.page?.url}/>
   :b.type==='thinking'?<Thinking key={i} part={b.part} live={running&&b.part.ms===undefined}/>
   :b.type==='confirm'?<Confirm key={i} part={b.part} chatId={chatId}/>
   :<div key={i} className={b.answer?'answer':'note'}><Reveal text={b.part.text} streaming={running&&b===lastBlock} sources={turn.sources}/></div>)}
  {lastSteps<0&&view&&running&&<LiveView view={view} running/>}
  {running&&idle(turn)&&<Working turn={turn}/>}
  {!running&&!!cited.length&&<Sources list={cited}/>}
  {!running&&<Footer turn={turn} answer={answerText} retry={retry}/>}
 </article>;
}
/** Nothing is streaming right now (between steps, or before the first word): a line says it is still at work. */
const idle=(turn:Turn)=>{const p=turn.parts.at(-1);return!p||p.kind==='tool'&&(p.status==='done'||p.status==='failed'||p.status==='declined')||p.kind==='thinking'&&p.ms!==undefined||p.kind==='todos'||p.kind==='memory'||p.kind==='confirm'&&p.status!=='waiting';};
function useTicking(on:boolean){const [,set]=useState(0);useEffect(()=>{if(!on)return;const t=setInterval(()=>set(n=>n+1),1000);return()=>clearInterval(t);},[on]);}
function Working({turn}:{turn:Turn}){
 useTicking(true);
 const steps=turn.parts.filter(p=>p.kind==='tool').length;
 return <div className="working"><LoaderCircle className="spin" size={13}/><span className="shimmer">{turn.parts.length?'Working':'Thinking'}</span><span className="time">{duration(Date.now()-turn.startedAt)}{steps?` · ${steps} step${steps>1?'s':''}`:''}</span></div>;
}
function Thinking({part,live}:{part:Extract<Part,{kind:'thinking'}>;live:boolean}){
 useTicking(live);
 return <details className="thinking"><summary><Lightbulb size={13}/><span className={live?'shimmer':''}>{live?`Thinking for ${duration(Date.now()-part.started)}`:`Thought for ${duration(part.ms??0)}`}</span>{part.text&&<ChevronRight className="chev" size={12}/>}</summary>{part.text&&<p>{part.text}</p>}</details>;
}
function Plan({items,running}:{items:{text:string;done:boolean}[];running:boolean}){
 const done=items.filter(i=>i.done).length,current=running?items.findIndex(i=>!i.done):-1;
 return <div className="plan">
  <div className="head"><ListTodo size={13}/><span>Plan</span><span className="count">{done} of {items.length}</span><span className="bar"><span style={{width:`${items.length?done/items.length*100:0}%`}}/></span></div>
  <ul>{items.map((t,i)=><li key={i} className={t.done?'done':i===current?'now':''}><span className="box">{t.done?<Check size={10}/>:i===current?<LoaderCircle className="spin" size={10}/>:null}</span><span>{t.text}</span></li>)}</ul>
 </div>;
}

// ---- Steps ----
/** Reading and looking things up fold together (as Cursor's "Explored"); what changes something stands on its own. */
const explores=new Set(['read_page','search_memory','tabs','wait','scroll','gmail_search','gmail_read','calendar_events','drive_search','doc_read','supabase_projects','vercel_deployments','vercel_build_log','stripe_list']);
const isLive=(t:Tool)=>t.status==='drafting'||t.status==='running';
/** page: the site the request is about; a step there needs no icon, a step elsewhere shows where. */
function Steps({tools,running,view,page}:{tools:Tool[];running:boolean;view?:View;page?:string}){
 const rows:(Tool|Tool[])[]=[];
 for(const t of tools){const prev=rows.at(-1);if(explores.has(t.name)&&t.name!=='search_memory'){if(Array.isArray(prev))prev.push(t);else rows.push([t]);}else rows.push(t);}
 return <div className="steps">
  {rows.map(r=>Array.isArray(r)?r.length===1?<Step key={r[0].id} tool={r[0]} running={running} page={page}/>:<Explored key={r[0].id} tools={r} running={running} page={page}/>:<Step key={r.id} tool={r} running={running} page={page}/>)}
  {view&&<LiveView view={view} running={running}/>}
 </div>;
}
function Explored({tools,running,page}:{tools:Tool[];running:boolean;page?:string}){
 const current=running?tools.find(isLive):undefined,ms=tools.reduce((s,t)=>s+(t.ms??0),0);
 const sites=[...new Set(tools.map(t=>t.url).filter((u):u is string=>!!u&&host(u)!==host(page)).map(u=>new URL(u).origin))].slice(0,4);
 const reads=tools.filter(t=>t.name==='read_page'||t.name==='doc_read'||t.name==='gmail_read').length,others=tools.length-reads;
 const what=[reads&&`read ${reads} page${reads>1?'s':''}`,others&&`${others} more look${others>1?'s':''}`].filter(Boolean).join(', ');
 return <details className="step group" open={!!current}>
  <summary className="row">
   <span className="icon">{current?<LoaderCircle className="spin" size={13}/>:<Telescope size={13}/>}</span>
   <span className={`label ${current?'shimmer':''}`}>{current?words(current).join(' '):`Explored · ${what}`}</span>
   <span className="favs">{sites.map(s=><Favicon key={s} url={s} size={12}/>)}</span>
   <span className="time">{current?'':duration(ms)}</span><ChevronRight className="chev" size={12}/>
  </summary>
  <div className="nested">{tools.map(t=><Step key={t.id} tool={t} running={running} page={page}/>)}</div>
 </details>;
}
const icons:Record<string,typeof Globe>={read_page:ScanText,click:MousePointerClick,type:Keyboard,key:CornerDownLeft,select:ChevronsUpDown,scroll:ArrowDownUp,wait:Hourglass,open:Globe,tabs:PanelsTopLeft,switch_tab:ArrowRightLeft,search_memory:Brain,
 gmail_search:Mail,gmail_read:Mail,gmail_draft:Mail,calendar_events:CalendarDays,calendar_create:CalendarDays,drive_search:FileText,doc_read:FileText,supabase_projects:Database,supabase_sql:Database,vercel_deployments:Triangle,vercel_build_log:Triangle,stripe_list:CreditCard};
function Step({tool,running,page}:{tool:Tool;running:boolean;page?:string}){
 const live=running&&isLive(tool);
 const detail=detailOf(tool);
 const [open,setOpen]=useState<boolean|undefined>(undefined);
 const shown=open??(tool.name==='search_memory'&&!!tool.results?.length);
 const Icon=icons[tool.name]??Globe;
 const [verb,target]=words(tool);
 return <div className={`step ${tool.status}`}>
  <button className="row" onClick={()=>detail&&setOpen(!shown)} disabled={!detail}>
   <span className="icon">{live?<LoaderCircle className="spin" size={13}/>:tool.status==='failed'?<X size={13}/>:tool.status==='declined'?<Ban size={13}/>:<Icon size={13}/>}</span>
   <span className={`label ${live?'shimmer':''}`}>{verb}{target&&<> <span className="target">{target}</span></>}</span>
   {tool.url&&!live&&host(tool.url)!==host(page)&&<span className="favs" title={host(tool.url)}><Favicon url={tool.url} size={12}/></span>}
   <span className="time">{live||tool.ms===undefined?'':duration(tool.ms)}</span>
   {detail&&<ChevronRight className={`chev ${shown?'open':''}`} size={12}/>}
  </button>
  {shown&&detail&&<div className="detail">{detail}</div>}
 </div>;
}
/** What a step did, in words (shared with Ctrl+K's card). */
const words=(p:Tool)=>stepWords(p);
function detailOf(p:Tool):ReactNode{
 if(p.name==='search_memory'&&p.results?.length)return <Memories found={p.results}/>;
 if(p.name==='search_memory'&&p.status==='done')return <p className="meta">Nothing in memory matched.</p>;
 if(p.name==='type'&&p.input?.text&&String(p.input.text).length>40)return <p className="quote">{p.input.text}</p>;
 if(p.name==='supabase_sql'&&p.input?.sql)return <pre>{p.input.sql}</pre>;
 if((p.status==='failed'||p.status==='declined')&&p.summary)return <p className="meta">{p.summary}</p>;
 if(p.summary&&p.name!=='read_page'&&p.name!=='switch_tab'&&p.name!=='gmail_read'&&p.name!=='doc_read')return <p className="meta">{p.summary}</p>;
 if(p.url&&(p.name==='read_page'||p.name==='open'))return <p className="meta"><Favicon url={p.url} size={11}/> {p.url}</p>;
 return null;
}
/** What memory gave back, as cards: what kind of thing, when, the words that matched. */
/** What memory gave the request before it began: always looked up. One row naming what it found; open for the cards. */
function Remembered({found}:{found:Found[]}){
 const [open,setOpen]=useState(false);
 const names=found.slice(0,2).map(f=>f.title.length>34?`${f.title.slice(0,33)}…`:f.title);
 return <div className="step remembered">
  <button className="row" onClick={()=>setOpen(!open)}>
   <span className="icon"><Brain size={13}/></span>
   <span className="label">Remembered {names.map((n,i)=><span key={i}> <span className="target">{n}</span></span>)}{found.length>2?<span className="more"> +{found.length-2}</span>:null}</span>
   <ChevronRight className={`chev ${open?'open':''}`} size={12}/>
  </button>
  {open&&<div className="detail"><Memories found={found}/></div>}
 </div>;
}
function Memories({found}:{found:Found[]}){
 const [all,setAll]=useState(false),shown=all?found:found.slice(0,3);
 return <ul className="memories">{shown.map(f=><li key={f.n}>
  <a href={f.url} target="_blank" rel="noreferrer" onClick={e=>{if(!f.url)e.preventDefault();}}>
   <span className="head"><KindIcon kind={f.kind} size={12}/><span className="title">{f.title}</span><span className="when">{f.when}</span><span className="n">{f.n}</span></span>
   <span className="snippet">{f.snippet}</span>
  </a>
 </li>)}{found.length>3&&<li><button className="more" onClick={()=>setAll(!all)}>{all?'Show fewer':`Show ${found.length-3} more`}</button></li>}</ul>;
}
/** The latest look at the page it works in, with what it just touched outlined. */
function LiveView({view,running}:{view:View;running:boolean}){
 const b=view.box;
 return <figure className={`live-view ${running?'running':''}`}>
  <div className="shot"><img src={view.src} alt=""/>{b&&<span className="box" style={{left:`${b[0]*100}%`,top:`${b[1]*100}%`,width:`${b[2]*100}%`,height:`${b[3]*100}%`}}/>}</div>
  <figcaption><Favicon url={view.url} size={11}/><span className="title">{view.title||host(view.url)}</span>{running?<span className="live"><span className="dot"/>Live</span>:<span className="when">{ago(view.at)}</span>}</figcaption>
 </figure>;
}
function Confirm({part,chatId}:{part:Extract<Part,{kind:'confirm'}>;chatId:string}){
 const waiting=part.status==='waiting';
 if(!waiting)return <div className={`decided ${part.status}`}>{part.status==='yes'?<Check size={13}/>:<Ban size={13}/>}<span>{part.status==='yes'?'Allowed':'Denied'}: {part.text.replace(/\?$/,'')}</span></div>;
 return <div className="confirm">
  <div className="head"><ShieldCheck size={14}/><span>Needs your OK</span></div>
  <p className="what">{part.url&&<Favicon url={part.url} size={14}/>}<span>{part.text}</span></p>
  <div className="row">
   <button className="yes" onClick={()=>post({type:'agent.confirm',chat:chatId,id:part.id,yes:true})}>Allow <kbd>Enter</kbd></button>
   <button onClick={()=>post({type:'agent.confirm',chat:chatId,id:part.id,yes:false})}>Deny <kbd>Esc</kbd></button>
  </div>
 </div>;
}
function Sources({list}:{list:(Source&{kind?:string})[]}){
 return <div className="sources">{list.map(s=>{const inner=<><span className="n">{s.n}</span>{s.url?<Favicon url={s.url} size={12}/>:<KindIcon kind={s.kind} size={12}/>}<span className="title">{s.title}</span></>;
  return s.url?<a key={s.n} className="source" href={s.url} target="_blank" rel="noreferrer" title={s.title}>{inner}</a>:<span key={s.n} className="source" title={s.title}>{inner}</span>;})}</div>;
}
function Footer({turn,answer,retry}:{turn:Turn;answer:string;retry:()=>void}){
 const [copied,setCopied]=useState(false);
 const steps=turn.parts.filter(p=>p.kind==='tool').length,ms=(turn.endedAt??Date.now())-turn.startedAt;
 if(turn.status==='failed')return <div className="failed"><p>{turn.error??'Something went wrong.'}</p><button onClick={retry}><RotateCcw size={12}/>Try again</button></div>;
 return <div className="foot">
  {answer&&<button onClick={()=>{void navigator.clipboard.writeText(answer.replace(/\[(\d+)\]/g,''));setCopied(true);setTimeout(()=>setCopied(false),1200);}} title="Copy the answer">{copied?<Check size={12}/>:<Copy size={12}/>}</button>}
  <span>{turn.status==='stopped'?'Stopped':steps?`Worked for ${duration(ms)} · ${steps} step${steps>1?'s':''}`:duration(ms)}</span>
  {turn.costUsd>=0.001&&<span title="What the AI cost for this">· {turn.costUsd<0.1?`${(turn.costUsd*100).toFixed(1)}¢`:`$${turn.costUsd.toFixed(2)}`}</span>}
 </div>;
}
/** Text revealed smoothly as it streams: each frame shows a little more, more when far behind, so a burst of tokens
 * never jumps and a slow stream never stalls. Finished text shows at once. */
function Reveal({text,streaming,sources}:{text:string;streaming:boolean;sources:Source[]}){
 const [shown,setShown]=useState(streaming?0:text.length);const target=useRef(text.length);target.current=text.length;
 useEffect(()=>{
  if(!streaming){setShown(text.length);return;}
  let frame=0;const tick=()=>{setShown(n=>{const behind=target.current-n;return behind<=0?n:n+Math.max(1,Math.ceil(behind/8));});frame=requestAnimationFrame(tick);};
  frame=requestAnimationFrame(tick);return()=>cancelAnimationFrame(frame);
 },[streaming]);
 return <Markdown text={streaming?text.slice(0,shown):text} streaming={streaming} cited={sources}/>;
}
/** "@": the open tabs, filtered by what is typed after it; arrows move, Enter adds, Esc closes. */
function TabPicker({query,exclude,pick,close}:{query:string;exclude:(number|undefined)[];pick:(t:TabInfo)=>void;close:()=>void}){
 const [tabs,setTabs]=useState<TabInfo[]>([]);const [at,setAt]=useState(0);
 useEffect(()=>{void chrome.tabs.query({lastFocusedWindow:true}).then(all=>setTabs(all.filter(t=>t.id!==undefined&&web(t.url)&&!exclude.includes(t.id)).map(t=>({id:t.id!,title:t.title??'',url:t.url??''}))));},[]);
 const q=query.toLowerCase(),shown=tabs.filter(t=>!q||t.title.toLowerCase().includes(q)||t.url.toLowerCase().includes(q)).slice(0,8);
 useEffect(()=>{setAt(0);},[query]);
 useEffect(()=>{
  const key=(e:KeyboardEvent)=>{
   if(e.key==='ArrowDown'){e.preventDefault();setAt(a=>Math.min(shown.length-1,a+1));}
   else if(e.key==='ArrowUp'){e.preventDefault();setAt(a=>Math.max(0,a-1));}
   else if((e.key==='Enter'||e.key==='Tab')&&shown[at]){e.preventDefault();e.stopPropagation();pick(shown[at]);}
   else if(e.key==='Escape'){e.preventDefault();close();}
  };
  window.addEventListener('keydown',key,true);return()=>window.removeEventListener('keydown',key,true);
 },[shown,at]);
 return <div className="picker">
  <div className="title"><AtSign size={12}/>Add a tab</div>
  {!shown.length&&<p className="meta">No other open tabs{q?` match “${query}”`:''}.</p>}
  {shown.map((t,i)=><button key={t.id} className={i===at?'on':''} onMouseEnter={()=>setAt(i)} onMouseDown={e=>{e.preventDefault();pick(t);}}><Favicon url={t.url} size={14}/><span className="title">{t.title||host(t.url)}</span><span className="site">{host(t.url)}</span></button>)}
 </div>;
}
