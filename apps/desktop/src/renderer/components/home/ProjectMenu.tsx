import React,{useEffect,useRef,useState} from 'react';
import {createPortal} from 'react-dom';
import {Pin,PinOff,FolderOpen,Archive,ArchiveRestore,Trash2,X,ArrowUpRight,ListX,CloudUpload} from 'lucide-react';
import type {ProjectSummary,ProjectAction} from '@dream/contracts';

/** A project's menu on right-click (in the sidebar or on its card): open, pin, show in folder, archive, remove from the
 * list, delete. Delete asks first, in the app, and says the folder goes to the Recycle Bin. */
export type MenuAt={project:ProjectSummary;x:number;y:number};
export function ProjectMenu(p:{at:MenuAt|null;onClose:()=>void;onOpen:(project:ProjectSummary)=>void;onAction:(project:ProjectSummary,action:ProjectAction)=>Promise<void>}){
 const menu=useRef<HTMLDivElement>(null),[confirm,setConfirm]=useState<ProjectSummary|null>(null),[pos,setPos]=useState({x:0,y:0});
 useEffect(()=>{if(!p.at)return;setPos({x:p.at.x,y:p.at.y});
  const away=(e:MouseEvent)=>{if(!menu.current?.contains(e.target as Node))p.onClose();},key=(e:KeyboardEvent)=>{if(e.key==='Escape')p.onClose();};
  document.addEventListener('mousedown',away);document.addEventListener('keydown',key);window.addEventListener('blur',p.onClose);
  return()=>{document.removeEventListener('mousedown',away);document.removeEventListener('keydown',key);window.removeEventListener('blur',p.onClose);};
 },[p.at]);
 // Kept on screen: flipped up or left when it would run off the window's edge.
 useEffect(()=>{const m=menu.current;if(!m||!p.at)return;const r=m.getBoundingClientRect();setPos({x:Math.min(p.at.x,innerWidth-r.width-8),y:p.at.y+r.height>innerHeight-8?Math.max(8,p.at.y-r.height):p.at.y});},[p.at]);
 const act=(action:ProjectAction)=>{const project=p.at!.project;p.onClose();void p.onAction(project,action);};
 const at=p.at,project=at?.project;
 return createPortal(<>
  {at&&project&&<div ref={menu} className="project-menu" role="menu" aria-label={`${project.name} options`} style={{left:pos.x,top:pos.y}}>
   <button type="button" role="menuitem" onClick={()=>{p.onClose();p.onOpen(project);}}><ArrowUpRight size={15}/>Open</button>
   {!project.archived&&<button type="button" role="menuitem" onClick={()=>act(project.pinned?'unpin':'pin')}>{project.pinned?<PinOff size={15}/>:<Pin size={15}/>}{project.pinned?'Unpin':'Pin to top'}</button>}
   <button type="button" role="menuitem" disabled={project.missing} onClick={()=>act('reveal')}><FolderOpen size={15}/>Show in folder</button>
   <button type="button" role="menuitem" disabled={project.missing} onClick={()=>act('cloud')}><CloudUpload size={15}/>Save to cloud</button>
   <button type="button" role="menuitem" onClick={()=>act(project.archived?'unarchive':'archive')}>{project.archived?<ArchiveRestore size={15}/>:<Archive size={15}/>}{project.archived?'Unarchive':'Archive'}</button>
   <hr/>
   <button type="button" role="menuitem" onClick={()=>act('forget')}><ListX size={15}/>Remove from list</button>
   <button type="button" role="menuitem" className="danger" onClick={()=>{setConfirm(project);p.onClose();}}><Trash2 size={15}/>Delete…</button>
  </div>}
  {confirm&&<div className="project-confirm-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setConfirm(null);}}>
   <section className="project-confirm" role="alertdialog" aria-modal="true" aria-label="Delete project">
    <button type="button" className="upgrade-close" aria-label="Cancel" onClick={()=>setConfirm(null)}><X size={16}/></button>
    <h3>Delete “{confirm.name}”?</h3>
    <p>The project's folder, with its edit and its media, moves to the Recycle Bin. You can restore it from there.</p>
    <footer><button type="button" className="settings-button-secondary" onClick={()=>setConfirm(null)}>Cancel</button><button type="button" className="project-delete" onClick={()=>{const project=confirm;setConfirm(null);void p.onAction(project,'trash');}}>Delete</button></footer>
   </section>
  </div>}
 </>,document.body);
}
