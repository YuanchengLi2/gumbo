import React from 'react';
import {Folder,Type,Smile,Wand2,ChevronsRight,Blend,Captions,ListTree} from 'lucide-react';
import type {SidebarTab} from '../../store/editor';

/** The editor's assets panel, after OpenCut's: a rail of tabs down the left (media, then the libraries) and the open tab
 * beside it. Gumbo's chat is the other layout, one click away in the header. No box and no button bar: the rail is icons
 * with their names under them. */
export const ASSET_TABS:{id:SidebarTab;label:string;icon:React.ReactNode}[]=[
 {id:'media',label:'Media',icon:<Folder size={17}/>},
 {id:'text',label:'Text',icon:<Type size={17}/>},
 {id:'stickers',label:'Stickers',icon:<Smile size={17}/>},
 {id:'effects',label:'Effects',icon:<Wand2 size={17}/>},
 {id:'transitions',label:'Transitions',icon:<ChevronsRight size={17}/>},
 {id:'filters',label:'Filters',icon:<Blend size={17}/>},
 {id:'captions',label:'Captions',icon:<Captions size={17}/>},
 {id:'elements',label:'Elements',icon:<ListTree size={17}/>}];

export function AssetsPanel(p:{tab:SidebarTab;onTab:(tab:SidebarTab)=>void;tabs:SidebarTab[];children:React.ReactNode}){
 return <aside className="editor-assets" aria-label="Assets">
  <nav className="editor-rail" aria-label="Asset tabs">{ASSET_TABS.filter(t=>p.tabs.includes(t.id)).map(t=><button key={t.id} type="button" aria-pressed={p.tab===t.id} aria-label={t.label} className={'rail-tab tab-'+t.id} onClick={()=>p.onTab(t.id)}>{t.icon}<span>{t.label}</span></button>)}</nav>
  <div className="sidebar editor-assets-body">{p.children}</div>
 </aside>;
}
