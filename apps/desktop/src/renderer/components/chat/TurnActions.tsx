import React,{useState} from 'react';
import {ThumbsUp,ThumbsDown,RotateCcw,Copy,Check} from 'lucide-react';
import {rateEdit} from '../../improve';
import {SendLog} from './SendLog';

/** Copies text, showing a tick for a moment. */
export function CopyButton({text,label='Copy'}:{text:string;label?:string}){
 const [done,setDone]=useState(false);
 const copy=async()=>{try{await navigator.clipboard.writeText(text);setDone(true);setTimeout(()=>setDone(false),1400);}catch{}};
 return <button type="button" className="turn-action" aria-label={label} title={done?'Copied':label} onClick={()=>void copy()}>{done?<Check size={14}/>:<Copy size={14}/>}</button>;
}

const RATED='gumbo-rating:';
const savedRating=(turnId:string)=>{try{const v=localStorage.getItem(RATED+turnId);return v==='up'||v==='down'?v:null;}catch{return null;}};

/** Under a finished request: rate it (kept with the project, and with the edit's log when edits are shared), do it again,
 * copy the reply, or send its log. Redo sends the same request again through the composer's own send. */
export function TurnActions({turnId,request,reply,running}:{turnId:string;request?:string;reply?:string;running?:boolean}){
 const [rating,setRating]=useState<'up'|'down'|null>(()=>savedRating(turnId));
 const rate=(next:'up'|'down')=>{const value=rating===next?null:next;setRating(value);try{if(value)localStorage.setItem(RATED+turnId,value);else localStorage.removeItem(RATED+turnId);}catch{}void rateEdit(turnId,value);};
 const redo=()=>{if(request)window.dispatchEvent(new CustomEvent('gumbo:send',{detail:`Try again: ${request}`}));};
 return <div className="turn-actions">
  <button type="button" className={'turn-action'+(rating==='up'?' on':'')} aria-label="Good edit" aria-pressed={rating==='up'} title="Good edit" onClick={()=>rate('up')}><ThumbsUp size={14}/></button>
  <button type="button" className={'turn-action'+(rating==='down'?' on':'')} aria-label="Bad edit" aria-pressed={rating==='down'} title="Bad edit" onClick={()=>rate('down')}><ThumbsDown size={14}/></button>
  {request&&<button type="button" className="turn-action" aria-label="Redo" title="Redo" disabled={running} onClick={redo}><RotateCcw size={14}/></button>}
  {reply&&<CopyButton text={reply}/>}
  <SendLog turnId={turnId}/>
 </div>;
}
