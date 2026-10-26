import {createRoot} from 'react-dom/client';
import {useEffect,useState} from 'react';
import {MessageSquare,AudioLines,Clock,SquarePen} from 'lucide-react';
import '../shared/tokens.css';
import './sidepanel.css';
import {Bowl} from '../shared/Bowl';
import {Chat} from './Chat';
import {Heard} from './Heard';
import {request,post} from './port';
import {ago} from './ui';
/** The side panel: the agent (ask about the page or anything remembered, or have it act in the page), what Gumbo hears
 * (live captions, notes, everything heard before), and past conversations. Memory has no tab of its own: it is simply
 * there, in every answer. */
type View='chat'|'heard'|'history';
function Panel(){
 const [view,setView]=useState<View>(location.hash==='#heard'?'heard':'chat');
 // Memory and its model get ready as the panel opens, so the first question is answered at once.
 useEffect(()=>{post({type:'memory.warm'});},[]);
 const [chatId,setChatId]=useState<string>();const [heardId,setHeardId]=useState<string>();const [listening,setListening]=useState(0);
 const tab=(id:View,name:string,Icon:typeof Clock,extra?:React.ReactNode)=><button className={view===id?'on':''} onClick={()=>{setView(id);if(id==='heard')setHeardId(undefined);}} title={name}><Icon size={14}/><span>{name}</span>{extra}</button>;
 return <main className={`on-${view}`}>
  <header>
   <Bowl size={20}/>
   <nav>
    {tab('chat','Chat',MessageSquare)}
    {tab('heard','Heard',AudioLines,listening?<span className="dot"/>:null)}
    {tab('history','History',Clock)}
   </nav>
   {view==='chat'&&<button className="new" onClick={()=>setChatId(undefined)} title="New conversation" disabled={!chatId}><SquarePen size={15}/></button>}
  </header>
  <div className="view" hidden={view!=='chat'}><Chat chatId={chatId} onChat={setChatId}/></div>
  <div className="view" hidden={view!=='heard'}><Heard openId={heardId} setOpenId={setHeardId} onLive={setListening}/></div>
  {view==='history'&&<div className="view"><History open={id=>{setChatId(id);setView('chat');}}/></div>}
 </main>;
}
function History({open}:{open:(id:string)=>void}){
 const [items,setItems]=useState<{id:string;title:string;at:number}[]>();
 useEffect(()=>{void request<{items:{id:string;title:string;at:number}[]}>({type:'agent.chats'},'agent.chats').then(r=>setItems(r?.items??[]));},[]);
 if(!items)return null;
 return <section className="history"><h2>Conversations</h2>{!items.length?<p className="empty">Nothing yet. Conversations are kept on this computer, sealed.</p>:
  <ul className="list">{items.map(i=><li key={i.id}><button onClick={()=>open(i.id)}><MessageSquare size={13}/><span className="title">{i.title}</span><span className="meta">{ago(i.at)}</span></button></li>)}</ul>}</section>;
}
createRoot(document.getElementById('root')!).render(<Panel/>);
