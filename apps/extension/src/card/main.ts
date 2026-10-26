/// <reference types="chrome" />
import './card.css';
/** Ctrl+K's card, in its own frame so the page never sees what is typed in it (nor can its shortcuts react to it). It
 * talks to the content script that opened it through the engine, paired by a session id only the two know. It shows:
 * the instruction box, and under it, before anything is typed, what the user most likely wants (arrows or Tab choose,
 * Enter runs it); then, as the answer streams, the old text struck through above the new, which becomes a word diff when
 * it ends (edit), a short answer with its sources (answer), the action to take (act), or, for something done in the page,
 * its steps as they happen with Enter to allow a final one (doing). */
type Segment={t:'same'|'add'|'del';v:string};
type Idea={text:string;kind:'edit'|'answer'|'act'|'page'};
type Step={text:string;status:string};
type View={state:'ask'|'working'|'edit'|'answer'|'act'|'doing'|'error';inField?:boolean;selected?:string;old?:string;text?:string;final?:boolean;diff?:Segment[];sources?:{n:number;title:string;url?:string}[];error?:string;applied?:boolean;
 ideas?:Idea[];steps?:Step[];confirm?:{id:string;text:string};said?:string;status?:string;done?:boolean};
const session=new URLSearchParams(location.hash.slice(1)).get('s')??'';
const port=chrome.runtime.connect({name:'card:'+session});
const input=document.getElementById('instruction') as HTMLInputElement,body=document.getElementById('body')!,foot=document.getElementById('foot')!,card=document.getElementById('card')!;
let view:View={state:'ask'},pick=0;
const send=(message:Record<string,unknown>)=>port.postMessage(message);

// Typing straight after Ctrl+K lands in two places: the page holds what came before this card could take the keys, and
// sends it once the card is up; keys typed here before that arrives wait behind it, so everything is applied in order.
let synced=false;const queued:string[]=[];
const held=(key:string)=>key.length===1||['Enter','Escape','Backspace','Tab','ArrowDown','ArrowUp'].includes(key);
function apply(keys:string[]){
 for(const key of keys){
  if(key.length===1){input.value+=key;render();}
  else if(key==='Backspace'){input.value=input.value.slice(0,-1);render();}
  else press({key,isComposing:false,preventDefault(){}});
 }
}
// Keys that arrive after the card went on by itself are still typed, never lost.
function sync(keys:string[]){if(synced){apply(keys);return;}synced=true;apply(keys);apply(queued.splice(0));}
// The page always answers (with nothing, if nothing was typed); if it cannot, the card goes on by itself.
setTimeout(()=>sync([]),4000);
port.onMessage.addListener((message:View&{type?:string;keys?:string[]})=>{
 if(message.type==='view'){view={...view,...message};render();}
 if(message.type==='focus')input.focus();
 if(message.type==='keys')sync(message.keys??[]);
});
new ResizeObserver(()=>send({type:'height',px:Math.ceil(document.documentElement.getBoundingClientRect().height)})).observe(card);
input.addEventListener('input',()=>render());
input.addEventListener('keydown',event=>{
 event.stopPropagation();
 if(!synced&&!event.isComposing&&!event.ctrlKey&&!event.metaKey&&!event.altKey&&held(event.key)){event.preventDefault();queued.push(event.key);return;}
 press(event);
});
function press(event:{key:string;isComposing:boolean;preventDefault():void}){
 const ideas=view.state==='ask'&&!input.value?view.ideas??[]:[];
 if(view.state==='doing'){
  // A final step waits for the user: Enter allows it, Esc does not. Otherwise Esc stops (or closes, once it is done).
  if(event.key==='Enter'&&view.confirm){event.preventDefault();send({type:'confirm',yes:true});return;}
  if(event.key==='Escape'){event.preventDefault();send(view.confirm?{type:'confirm',yes:false}:view.done?{type:'discard'}:{type:'stop'});return;}
  return;
 }
 if(ideas.length&&(event.key==='ArrowDown'||event.key==='ArrowUp')){event.preventDefault();pick=(pick+(event.key==='ArrowDown'?1:ideas.length-1))%ideas.length;render();return;}
 // Tab puts the chosen idea in the box, to run as it is or to change first.
 if(ideas.length&&event.key==='Tab'){event.preventDefault();input.value=ideas[pick].text;render();return;}
 if(event.key==='Escape'){event.preventDefault();send({type:'discard'});return;}
 if(event.key!=='Enter'||event.isComposing)return;
 event.preventDefault();
 if(ideas.length){run(ideas[pick].text,ideas[pick].kind);return;}
 const text=input.value.trim();
 const done=view.final&&(view.state==='edit'||view.state==='act'||view.state==='answer');
 const chosen=(view.ideas??[]).find(i=>i.text===text);
 if(text)run(text,chosen?.kind,done?view.text:undefined);
 // An answer, or an edit with nowhere to go, is copied: this frame has the keypress, so it may write the clipboard.
 else if(done&&(view.state==='answer'||view.state==='edit'&&!view.inField)){void navigator.clipboard.writeText(view.text??'').then(()=>send({type:'copied'}),()=>send({type:'copied'}));}
 else if(done)send({type:view.state==='act'?'do':'keep'});
}
function run(instruction:string,kind?:Idea['kind'],previous?:string){
 send({type:'submit',instruction,kind,previous});input.value='';
 view={...view,state:kind==='page'?'doing':'working',final:false,text:'',diff:undefined,steps:[],said:'',done:false,confirm:undefined,old:view.state==='edit'?view.old:undefined};render();
}
input.focus();send({type:'ready'});

const marks:Record<string,string>={done:'✓',failed:'✕',declined:'–'};
function render(){
 foot.hidden=false;
 const kbd=(key:string,what:string)=>`<span><kbd>${key}</kbd> ${what}</span>`;
 if(view.state==='ask'){
  input.placeholder=view.inField?(view.selected?'Edit, ask, or do something with the selection':'Write something here, ask, or do something'):'Ask about it, or do something with it';
  const ideas=input.value?[]:view.ideas??[];if(pick>=ideas.length)pick=0;
  body.hidden=!ideas.length;
  body.innerHTML=ideas.length?`<div class="ideas">${ideas.map((idea,i)=>`<div class="idea${i===pick?' on':''}" data-i="${i}"><span class="kind">${idea.kind==='page'?'↳':idea.kind==='act'?'↗':idea.kind==='answer'?'?':'✎'}</span>${escape(idea.text)}</div>`).join('')}</div>`:'';
  body.querySelectorAll<HTMLElement>('.idea').forEach(el=>el.addEventListener('mousedown',e=>{e.preventDefault();const idea=ideas[Number(el.dataset.i)];run(idea.text,idea.kind);}));
  foot.innerHTML=ideas.length?kbd('Enter','run')+kbd('↑↓','choose')+kbd('Tab','edit it')+kbd('Esc','close'):kbd('Enter','send')+kbd('Esc','close');return;
 }
 body.hidden=false;
 if(view.state==='doing'){
  // Something done in the page: its steps as they happen, a final one waiting for Enter, then how it went.
  const steps=(view.steps??[]).map(s=>`<div class="step ${s.status}"><span class="mark">${marks[s.status]??'<span class="spin"></span>'}</span>${escape(s.text)}</div>`).join('');
  const waiting=view.confirm?`<div class="confirm">${escape(view.confirm.text)}</div>`:'';
  const ending=view.done?(view.status==='failed'?`<div class="error">${escape(view.error??'That did not work.')}</div>`:view.said?`<div class="said">${escape(view.said)}</div>`:''):!view.confirm?'<span class="working">Working…</span>':'';
  body.innerHTML=`<div class="steps">${steps}</div>${waiting}${ending}`;
  foot.innerHTML=view.confirm?kbd('Enter','allow')+kbd('Esc','deny'):view.done?kbd('Esc','close'):kbd('Esc','stop');
  body.scrollTop=body.scrollHeight;return;
 }
 if(view.state==='working'&&!view.text){body.innerHTML='<span class="working">Thinking…</span>';foot.innerHTML=kbd('Esc','stop');return;}
 if(view.state==='error'){body.innerHTML=`<span class="error">${escape(view.error??'Something went wrong.')}</span>`;foot.innerHTML=kbd('Esc','close')+'<span>type to try again</span>';return;}
 if(view.state==='edit'||(view.state==='working'&&view.old!==undefined)){
  // While it streams: the old text struck through above the new. When it ends: one word diff.
  body.innerHTML=view.final&&view.diff?view.diff.map(s=>s.t==='same'?escape(s.v):s.t==='add'?`<ins>${escape(s.v)}</ins>`:`<del>${escape(s.v)}</del>`).join(''):`${view.old?`<div class="old">${escape(view.old)}</div>`:''}<div class="new">${escape(view.text??'')}</div>`;
  foot.innerHTML=view.final?(view.inField?kbd('Enter',view.old?'replace':'insert'):kbd('Enter','copy'))+kbd('Esc','discard')+'<span>type to change it</span>':kbd('Esc','stop');
  body.scrollTop=body.scrollHeight;return;
 }
 if(view.state==='answer'||view.state==='working'){
  const sources=view.sources??[],linked=escape(view.text??'').replace(/\[(\d+)\]/g,(m,n)=>{const s=sources.find(x=>x.n===Number(n));return s?.url?`<a class="cite" href="${escapeAttr(s.url)}" target="_blank" rel="noreferrer">[${n}]</a>`:m;});
  body.innerHTML=linked+(view.final&&sources.length&&/\[\d+\]/.test(view.text??'')?`<div class="sources">${sources.filter(s=>(view.text??'').includes(`[${s.n}]`)).map(s=>`<span>[${s.n}] ${s.url?`<a href="${escapeAttr(s.url)}" target="_blank" rel="noreferrer">${escape(s.title)}</a>`:escape(s.title)}</span>`).join('')}</div>`:'');
  foot.innerHTML=view.final?kbd('Enter','copy')+kbd('Esc','close')+'<span>type to ask more</span>':kbd('Esc','stop');return;
 }
 if(view.state==='act'){body.innerHTML=`<div class="action">${escape(view.text??'')}</div>`;foot.innerHTML=kbd('Enter','do it')+kbd('Esc','cancel');}
}
const escape=(s:string)=>s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
const escapeAttr=(s:string)=>/^https?:\/\//.test(s)?escape(s).replace(/"/g,'&quot;'):'#';
