/// <reference types="chrome" />
import {Globe,FileText,PenLine,AudioLines,StickyNote} from 'lucide-react';
/** Small pieces the panel's views share: a site's icon, the icon for a kind of memory, times in words. */
export function Favicon({url,size=14}:{url?:string;size?:number}){
 if(!url||!/^https?:/.test(url))return <Globe className="fav" size={size}/>;
 const src=chrome.runtime.getURL(`/_favicon/?pageUrl=${encodeURIComponent(url)}&size=${size*2}`);
 return <img className="fav" src={src} width={size} height={size} alt="" loading="lazy"/>;
}
export const host=(url?:string)=>{try{return new URL(url!).hostname.replace(/^www\./,'');}catch{return '';}};
export function KindIcon({kind,size=14}:{kind?:string;size?:number}){
 if(kind==='writing')return <PenLine className="kind" size={size}/>;
 if(kind==='media')return <AudioLines className="kind" size={size}/>;
 if(kind==='note')return <StickyNote className="kind" size={size}/>;
 return <FileText className="kind" size={size}/>;
}
export const kindName=(kind?:string)=>kind==='writing'?'You wrote':kind==='media'?'Heard':kind==='note'?'Note':'Read';
export function ago(at:number){
 const s=Math.round((Date.now()-at)/1000);
 if(s<60)return'just now';if(s<3600)return`${Math.floor(s/60)} min ago`;
 const d=new Date(at),today=new Date();
 const time=d.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'});
 if(d.toDateString()===today.toDateString())return time;
 const yesterday=new Date(Date.now()-86_400_000);if(d.toDateString()===yesterday.toDateString())return`Yesterday, ${time}`;
 return d.toLocaleDateString([],{month:'short',day:'numeric'});
}
export const duration=(ms:number)=>{const s=ms/1000;return s<1?`${Math.max(0.1,Math.round(s*10)/10)}s`:s<60?`${Math.round(s)}s`:`${Math.floor(s/60)}m ${Math.round(s%60)}s`;};
