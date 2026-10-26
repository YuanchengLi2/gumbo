import {useEffect,useLayoutEffect,useRef,useState} from 'react';
import {ask} from '../shared/protocol';
import {clock,momentUrl} from '../shared/moment';
/** What Gumbo hears, live (captions with who said them, which the user can name), notes when it ends, and everything
 * heard before; a time jumps the video to that moment. */
type Seg={start:number;end:number;speaker:string;text:string};
type Heard={id:string;title:string;url:string;kind:'meeting'|'video'|'audio';startedAt:number;endedAt?:number;segments:Seg[];notes?:string;live?:boolean;
 /** What is being said right now, before it is a line. */now?:{speaker:string;text:string}};
type Item={id:string;title:string;url:string;kind:Heard['kind'];startedAt:number;endedAt?:number;seconds:number;lines:number;notes:boolean};

export function Heard({openId,setOpenId,onLive}:{openId?:string;setOpenId:(id?:string)=>void;onLive?:(n:number)=>void}){
 const [live,setLive]=useState<Record<string,Heard>>({});
 const [list,setList]=useState<Item[]>();
 const [saved,setSaved]=useState<Heard>();
 const loadList=()=>void ask<{items:Item[]}>({type:'listen.recent'}).then(r=>setList(r?.items??[])).catch(()=>setList([]));
 useEffect(()=>{
  void chrome.tabs.query({active:true,currentWindow:true}).then(async([tab])=>{
   const state=await ask<{sessions:any[];here?:string}>({type:'listen.state',tabId:tab?.id}).catch(()=>({sessions:[] as any[],here:undefined}));
   const now:Record<string,Heard>={};for(const s of state.sessions)now[s.session]={id:s.session,title:s.title,url:s.url,kind:s.kind,startedAt:s.startedAt,segments:s.segments,live:true};
   setLive(now);if(state.here)setOpenId(state.here);
  });
  loadList();
  const onMessage=(m:any)=>{
   if(m?.type==='listen.caption')setLive(was=>{const h=was[m.session]??{id:m.session,title:m.title,url:'',kind:'video',startedAt:Date.now(),segments:[],live:true};return{...was,[m.session]:{...h,segments:[...h.segments,m.segment].sort((a,b)=>a.start-b.start)}};});
   if(m?.type==='listen.partial')setLive(was=>{const h=was[m.session]??{id:m.session,title:m.title,url:'',kind:'video',startedAt:Date.now(),segments:[],live:true};return{...was,[m.session]:{...h,now:m.text?{speaker:m.speaker,text:m.text}:undefined}};});
   if(m?.type==='listen.ended'){setLive(was=>{const {[m.session]:gone,...rest}=was;return rest;});loadList();}
   if(m?.type==='listen.notes'){setSaved(was=>was&&was.id===m.media?{...was,notes:m.notes}:was);loadList();}
  };
  chrome.runtime.onMessage.addListener(onMessage);return()=>chrome.runtime.onMessage.removeListener(onMessage);
 },[]);
 // A recording that ended while open is read back from memory (with its notes, once written).
 useEffect(()=>{if(!openId||live[openId]){setSaved(undefined);return;}void ask<Heard|null>({type:'listen.media',id:openId}).then(h=>setSaved(h??undefined));},[openId,!!(openId&&live[openId])]);
 const current=openId?live[openId]??saved:undefined;
 const liveOnes=Object.values(live);
 useEffect(()=>{onLive?.(liveOnes.length);},[liveOnes.length]);
 return <section className="heard">
  {current?<Transcript heard={current} back={()=>setOpenId(undefined)} rename={(speaker,name)=>{
   void ask({type:'listen.name',media:current.id,speaker,name});
   const relabel=(h:Heard)=>({...h,segments:h.segments.map(s=>s.speaker===speaker?{...s,speaker:name}:s)});
   if(live[current.id])setLive(was=>({...was,[current.id]:relabel(was[current.id])}));else setSaved(relabel(current));
  }}/>:<>
   {liveOnes.map(h=><button key={h.id} className="now" onClick={()=>setOpenId(h.id)}><span className="dot"/><span><b>Listening</b> · {h.title}<span className="last">{h.now?.text||h.segments.at(-1)?.text||'…'}</span></span></button>)}
   <h2>Heard</h2>
   {list===undefined?null:!list.length&&!liveOnes.length?<p className="empty">Nothing heard yet. Play a video or join a call, and what's said shows up here with who said it. It's kept on this computer, so Tab and Ctrl+K can use it.</p>:
    <ul className="list">{list.filter(i=>!live[i.id]).map(i=><li key={i.id}><button onClick={()=>setOpenId(i.id)}><span className="title">{i.title}</span><span className="meta">{kindName(i.kind)} · {when(i.startedAt)}{i.seconds?` · ${clock(i.seconds)}`:''}{i.notes?' · notes':''}</span></button></li>)}</ul>}
  </>}
 </section>;
}
const kindName=(k:Heard['kind'])=>k==='meeting'?'Meeting':k==='video'?'Video':'Audio';
function when(at:number){const d=new Date(at),today=new Date();const time=d.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});return d.toDateString()===today.toDateString()?time:`${d.toLocaleDateString([],{month:'short',day:'numeric'})}, ${time}`;}

function Transcript({heard,back,rename}:{heard:Heard;back:()=>void;rename:(speaker:string,name:string)=>void}){
 const scroller=useRef<HTMLDivElement>(null),follow=useRef(true);const [naming,setNaming]=useState<string>();
 // Sticks to the newest line while the user is at the bottom; scrolling up to read stops it.
 useLayoutEffect(()=>{const el=scroller.current;if(el&&follow.current)el.scrollTop=el.scrollHeight;},[heard.segments.length,heard.now?.text]);
 const turns:{speaker:string;start:number;text:string[]}[]=[];
 for(const s of heard.segments){const last=turns.at(-1);if(last&&last.speaker===s.speaker&&s.start-last.start<120)last.text.push(s.text);else turns.push({speaker:s.speaker,start:s.start,text:[s.text]});}
 const jumps=heard.kind!=='meeting'&&!!heard.url;
 return <section className="transcript">
  <div className="bar"><button className="back" onClick={back}>‹ Heard</button>{heard.live&&<span className="live"><span className="dot"/>Listening</span>}</div>
  <h1>{heard.url?<a href={heard.url} target="_blank" rel="noreferrer">{heard.title}</a>:heard.title}</h1>
  <p className="meta">{kindName(heard.kind)} · {when(heard.startedAt)}</p>
  {heard.notes&&<div className="notes">{heard.notes.split('\n').map((line,i)=><Line key={i} line={line} heard={heard} jumps={jumps}/>)}</div>}
  {!heard.notes&&!heard.live&&heard.segments.length>0&&<p className="meta">Notes come when a meeting ends, or a video ran a few minutes.</p>}
  <div className="lines" ref={scroller} onScroll={e=>{const el=e.currentTarget;follow.current=el.scrollHeight-el.scrollTop-el.clientHeight<40;}}>
   {turns.map((t,i)=><div className="turn" key={i}>
    <div className="who">
     {naming===t.speaker?<input autoFocus defaultValue={t.speaker.startsWith('Speaker')?'':t.speaker} placeholder={`Who is ${t.speaker}?`} onKeyDown={e=>{if(e.key==='Enter'&&e.currentTarget.value.trim()){rename(t.speaker,e.currentTarget.value.trim());setNaming(undefined);}if(e.key==='Escape')setNaming(undefined);}} onBlur={()=>setNaming(undefined)}/>:
      t.speaker?<button className="name" title={t.speaker==='You'?undefined:'Name this voice; Gumbo knows it next time'} disabled={t.speaker==='You'} onClick={()=>setNaming(t.speaker)}>{t.speaker}</button>:null}
     {jumps?<button className="time" onClick={()=>void jump(heard,t.start)}>{clock(t.start)}</button>:<span className="time">{clock(t.start)}</span>}
    </div>
    <p>{t.text.join(' ')}</p>
   </div>)}
   {heard.live&&heard.now&&<div className="turn now"><div className="who">{heard.now.speaker&&<span className="name">{heard.now.speaker}</span>}</div><p>{heard.now.text}</p></div>}
   {heard.live&&!heard.segments.length&&!heard.now&&<p className="meta">Listening… the first words show in a moment.</p>}
  </div>
 </section>;
}
/** A line of notes, with its [12:05] times as jumps. */
function Line({line,heard,jumps}:{line:string;heard:Heard;jumps:boolean}){
 if(/^(Decisions|To do|Key points):?\s*$/i.test(line.trim()))return <h3>{line.replace(/:\s*$/,'')}</h3>;
 const parts=line.split(/(\[\d{1,2}(?::\d{2}){1,2}\])/);
 return <p className={line.startsWith('- ')?'item':''}>{parts.map((p,i)=>{const m=/^\[(\d{1,2}(?::\d{2}){1,2})\]$/.exec(p);if(!m)return p.replace(/^- /,'');const s=m[1].split(':').reduce((a,b)=>a*60+Number(b),0);return jumps?<button key={i} className="time" onClick={()=>void jump(heard,s)}>{m[1]}</button>:<span key={i} className="time">{m[1]}</span>;})}</p>;
}
/** Jumps to a moment: in the open tab if it is that video, else in a new tab at that moment. */
async function jump(heard:Heard,at:number){
 const [tab]=await chrome.tabs.query({active:true,currentWindow:true});
 const same=(a:string,b:string)=>{try{const x=new URL(a),y=new URL(b);x.hash=y.hash='';x.searchParams.delete('t');y.searchParams.delete('t');return x.href===y.href;}catch{return false;}};
 if(tab?.id!==undefined&&tab.url&&same(tab.url,heard.url)){const r=await chrome.tabs.sendMessage(tab.id,{type:'listen.seek',at}).catch(()=>null);if(r?.ok)return;}
 await chrome.tabs.create({url:momentUrl(heard.url,at)});
}
