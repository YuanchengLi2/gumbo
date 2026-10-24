import React,{useState} from 'react';
import {X,Share2,Copy,Check,ExternalLink} from 'lucide-react';
import type {ProjectState} from '@dream/project-db';
import {requireSignIn} from '../../account';
import {shareStory} from '../../share-story';

/** Share link, after an export: a page anyone with the link can open (usegumbo.app/s/), with the video, the requests that
 * made it and a few stills of the footage it started from, and a button to try Gumbo. Making one asks to sign in. */
export function ShareDialog(p:{project:ProjectState;onClose:()=>void}){
 const [url,setUrl]=useState<string|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState<string|null>(null),[copied,setCopied]=useState(false);
 const prompts=p.project.messages.filter(m=>m.role==='user'&&m.text.trim()).length;
 const create=async()=>{setBusy(true);setError(null);
  try{if(!await requireSignIn())return;const made=await window.dream.shareExport(await shareStory(p.project));if(made)setUrl(made.url);}
  catch(e){setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/,''));}
  finally{setBusy(false);}};
 const copy=async()=>{if(!url)return;try{await navigator.clipboard.writeText(url);setCopied(true);setTimeout(()=>setCopied(false),2000);}catch{setError('Could not copy the link.');}};
 return <div className="dialog-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget&&!busy)p.onClose();}}>
  <section className="dialog share-dialog" role="dialog" aria-label="Share your video">
   <div className="dialog-header"><h2>Share how you made it</h2><button className="icon-button" aria-label="Close dialog" onClick={p.onClose}><X size={20}/></button></div>
   <p>Get a link to a page that shows your video next to {prompts===1?'the request':prompts?`the ${prompts} requests`:'the requests'} you typed and a few stills of the footage it started from. Anyone with the link can watch it and try Gumbo themselves.</p>
   {url&&<input className="share-url" readOnly aria-label="Share link" value={url} onFocus={e=>e.currentTarget.select()}/>}
   {error&&<p className="share-error" role="alert">{error}</p>}
   <div className="dialog-actions">
    {url?<><button className="button secondary" onClick={()=>window.open(url,'_blank','noopener')}><ExternalLink size={15}/>Open</button><button className="button primary" onClick={()=>void copy()}>{copied?<Check size={15}/>:<Copy size={15}/>}{copied?'Copied':'Copy link'}</button></>
     :<button className="button primary" disabled={busy} onClick={()=>void create()}><Share2 size={16}/>{busy?'Making the link…':'Create link'}</button>}
   </div>
  </section>
 </div>;
}
