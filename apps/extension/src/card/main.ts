/// <reference types="chrome" />
import './card.css';
/** Ctrl+K's card, in its own frame so the page never sees what is typed in it (nor can its shortcuts react to it). It
 * talks to the content script that opened it through the engine, paired by a session id only the two know. It shows:
 * the instruction box; then, as the answer streams, the old text struck through above the new, which becomes a word
 * diff when it ends (edit), a short answer with its sources (answer), or the action to take (act). */
type Segment={t:'same'|'add'|'del';v:string};
type View={state:'ask'|'working'|'edit'|'answer'|'act'|'error';inField?:boolean;selected?:string;old?:string;text?:string;final?:boolean;diff?:Segment[];sources?:{n:number;title:string;url?:string}[];error?:string;applied?:boolean};
const session=new URLSearchParams(location.hash.slice(1)).get('s')??'';
const port=chrome.runtime.connect({name:'card:'+session});
const input=document.getElementById('instruction') as HTMLInputElement,body=document.getElementById('body')!,foot=document.getElementById('foot')!,card=document.getElementById('card')!;
let view:View={state:'ask'};
const send=(message:Record<string,unknown>)=>port.postMessage(message);

port.onMessage.addListener((message:View&{type?:string})=>{if(message.type==='view'){view={...view,...message};render();}if(message.type==='focus')input.focus();});
new ResizeObserver(()=>send({type:'height',px:Math.ceil(document.documentElement.getBoundingClientRect().height)})).observe(card);
input.addEventListener('keydown',event=>{
 event.stopPropagation();
 if(event.key==='Escape'){event.preventDefault();send({type:'discard'});return;}
 if(event.key!=='Enter'||event.isComposing)return;
 event.preventDefault();const text=input.value.trim();
 const done=view.final&&(view.state==='edit'||view.state==='act'||view.state==='answer');
 if(text){send({type:'submit',instruction:text,previous:done?view.text:undefined});input.value='';view={...view,state:'working',final:false,text:'',diff:undefined,old:view.state==='edit'?view.old:undefined};render();}
 // An answer, or an edit with nowhere to go, is copied: this frame has the keypress, so it may write the clipboard.
 else if(done&&(view.state==='answer'||view.state==='edit'&&!view.inField)){void navigator.clipboard.writeText(view.text??'').then(()=>send({type:'copied'}),()=>send({type:'copied'}));}
 else if(done)send({type:view.state==='act'?'do':'keep'});
});
input.focus();send({type:'ready'});

function render(){
 body.hidden=view.state==='ask';foot.hidden=false;
 const kbd=(key:string,what:string)=>`<span><kbd>${key}</kbd> ${what}</span>`;
 if(view.state==='ask'){input.placeholder=view.inField?(view.selected?'Edit, ask, or do something with the selection':'Write something here, or ask'):'Ask about it, or do something with it';foot.innerHTML=kbd('Enter','send')+kbd('Esc','close');return;}
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
