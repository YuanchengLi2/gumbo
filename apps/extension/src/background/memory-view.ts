import {on} from './surfaces';
import {recent,counts} from './db';
import {offscreen} from './offscreen';
/** Memory for the side panel: warmed as it opens (so the first question is answered at once), and what was kept lately
 * (pages read, writing, what was heard, notes), from which the empty chat suggests questions. */
export type Remembered={id:string;kind:'page'|'writing'|'media'|'note';title:string;url?:string;at:number;snippet:string;site?:string};
// The panel opened: memory and its model get ready, so the first question is answered at once.
on('memory.warm',async()=>{await offscreen({type:'index.warm'}).catch(()=>{});});
on('memory.recent',async(_m,{send})=>{
 const [pages,writing,media,notes,kept]=await Promise.all([recent('pages',15).catch(()=>[]),recent('writing',10).catch(()=>[]),recent('media',8).catch(()=>[]),recent('notes',8).catch(()=>[]),counts().catch(()=>({}))]);
 const items:Remembered[]=[
  ...pages.map(p=>({id:'p'+p.url,kind:'page' as const,title:p.title,url:p.url,at:p.lastSeen,snippet:p.text.slice(0,200),site:p.site})),
  ...writing.map(w=>({id:'w'+w.id,kind:'writing' as const,title:`You wrote on ${w.site}${w.label?` (${w.label})`:''}`,url:w.url,at:w.at,snippet:w.text.slice(0,200),site:w.site})),
  ...media.map(x=>({id:'m'+x.id,kind:'media' as const,title:x.title,url:x.url,at:x.endedAt??x.startedAt,snippet:x.notes?.split('\n')[0]??x.segments.slice(0,3).map(s=>s.text).join(' ').slice(0,200),site:x.site})),
  ...notes.map(n=>({id:'n'+n.id,kind:'note' as const,title:n.title??'Your note',url:n.url,at:n.at,snippet:n.text.slice(0,200)})),
 ].sort((a,b)=>b.at-a.at).slice(0,40);
 send({type:'memory.recent',items,counts:kept});
});
