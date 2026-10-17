import {editingChanges} from './editing-language';
import React,{useEffect,useRef,useState} from 'react';

import type {PlayerRef} from './engine/EngineView';

import {resolve} from '@dream/timeline';

import {ArrowLeft,Undo2,Redo2,SlidersHorizontal,Upload,History,X,Download,Check,Share2,FolderOpen} from 'lucide-react';

import {useProjectSession} from './hooks/useProjectSession';

import {useEditor} from './store/editor';
import {approvesPlan} from '@dream/contracts';
import {selectionRefs} from '@dream/timeline';

import {HomeScreen} from './components/home/HomeScreen';

import {AIWorkspace} from './components/workspace/AIWorkspace';
import {ExportDialog,type ExportChoices} from './components/export/ExportDialog';
import {runExport,stopExports} from './engine/export-job';
import {useChatShortcuts} from './shortcuts';
import {useTheme} from './theme';
import {ProfileMenu,SettingsLayer} from './components/settings/SettingsMenu';



import {FileAccessPanel} from './components/files/FileAccessPanel';
import {SignInDialog} from './components/account/SignInDialog';
import {requireSignIn} from './account';



export function App(){const s=useProjectSession(),player=useRef<PlayerRef>(null),exportAbort=useRef<AbortController|null>(null),[dialog,setDialog]=useState<'export'|'share'|null>(null),[files,setFiles]=useState(false),[input,setInput]=useState(''),[homeInput,setHomeInput]=useState(''),[homePaths,setHomePaths]=useState<string[]>([]),[share,setShare]=useState<string|null>(null);
 const [signIn,setSignIn]=useState(false);useEffect(()=>{const open=()=>setSignIn(true);window.addEventListener('dream:sign-in',open);return()=>window.removeEventListener('dream:sign-in',open);},[]);
 const returned=useEditor(state=>state.returned);useEffect(()=>{if(returned!==null){setInput(value=>value.trim()?value:returned);useEditor.setState({returned:null});}},[returned]);const creating=useRef(false),project=s.project,active=project?.aiStatus==='running',duration=project?resolve(project.timeline,project.footage).durationSec:0;

 useTheme();
 function seek(frame:number){const current=useEditor.getState().project;if(!current)return;const n=Math.max(0,Math.min(Math.max(1,resolve(current.timeline,current.footage).durationInFrames)-1,frame));s.setFrame(n);player.current?.seekTo(n);}

 async function create(){if(creating.current||s.busy||!homeInput.trim())return;creating.current=true;try{if(!await requireSignIn())return;const {permission,model}=useEditor.getState(),p=await s.create({requestId:crypto.randomUUID(),text:homeInput.trim(),paths:homePaths,intent:permission,model});if(p){setHomeInput('');setHomePaths([]);setInput('');}}finally{creating.current=false;}}

 async function attach(paths?:string[]){try{if(paths){const documents=paths.filter(path=>!(/\.(mp4|mov|webm|mkv|m4v|avi|mts|m2ts|3gp|mpe?g|wmv|wav|mp3|m4a|aac|flac|ogg|png|jpe?g|webp|heic|heif|avif|gif)$/i.test(path)));if(documents.length){const note='Use these files for this edit: '+documents.map(path=>JSON.stringify(path)).join(', ');if(s.route==='home')setHomeInput(old=>old+(old?'\n':'')+note);else setInput(old=>old+(old?'\n':'')+note);paths=paths.filter(path=>!documents.includes(path));if(!paths.length)return;}}if(s.route==='home'){const selected=paths??await window.dream.pickMedia();setHomePaths(old=>[...new Set([...old,...selected])]);}else{const ids=await s.importFiles(paths);s.setAttachments([...new Set([...useEditor.getState().attachments,...ids])]);}}catch(error){s.setError((error as Error).message);}}

 // Every message is a new request; after a stop, the assistant decides whether it continues the stopped work.
 // The message shows and the composer clears at once; a failed send puts the text back.
 // A change asked for from a plan card sends its own text and leaves the composer alone.
 async function submit(override?:string){const text=(override??input).trim();if(!project||!text||active||s.busy)return false;if(!await requireSignIn())return false;const assetIds=override===undefined?s.attachments:[],store=useEditor.getState(),requestId=crypto.randomUUID();store.setPending({requestId,text,assetIds,selection:selectionRefs(project.timeline,project.footage,s.selected),createdAt:new Date().toISOString()});if(override===undefined){setInput('');s.setAttachments([]);}s.setSidebarTab('chat');
 // A go-ahead for a waiting plan approves it, and like leaving plan mode the composer goes back to editing automatically.
 const approval=project.aiStatus==='awaiting_approval'&&approvesPlan(text);if(approval&&store.permission==='plan')store.setPermission('auto');
 const result=await s.command({type:'message',text,selection:s.selected,assetIds,intent:approval?'auto':store.permission,model:store.model,requestId});if(!result&&useEditor.getState().pending?.requestId===requestId){useEditor.getState().setPending(null);if(override===undefined){setInput(text);s.setAttachments(assetIds);}}return !!result;}

 useEffect(()=>{const key=(e:KeyboardEvent)=>{if(s.route!=='ai'||dialog||files||(e.target as HTMLElement).closest('input,textarea,select,[contenteditable]'))return;if((e.target as HTMLElement).closest('button,summary')&&(e.code==='Space'||e.key==='Enter'))return;const mod=e.ctrlKey||e.metaKey;if(e.code==='Space'){e.preventDefault();player.current?.toggle();}else if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();seek(s.frame+(e.key==='ArrowRight'?1:-1)*(e.shiftKey?project?.timeline.settings.fps??30:1));}else if(mod&&e.key.toLowerCase()==='z'){e.preventDefault();void s.command({type:e.shiftKey?'redo':'undo'});}else if(e.key==='Escape')s.setSelected([]);};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[s.route,s.frame,dialog,files,project?.versionId,active]);

 useChatShortcuts();
 async function exportVideo(request:ExportChoices|'timeline'){s.setProgress({status:'rendering',progress:0});
  try{if(request==='timeline'){const result=await window.dream.exportVideo('timeline');if(!result)s.setProgress(null);return;}
   // The engine draws and encodes the video here, on the graphics card; the main process mixes the sound and joins them.
   // The agent's exports run the same job (export-job.ts).
   const job=await window.dream.beginExport(request),abort=new AbortController();exportAbort.current=abort;
   const current=useEditor.getState().project!;await runExport(job,current.timeline,current.footage,s.setProgress);}
  catch(error){if(exportAbort.current?.signal.aborted)s.setProgress({status:'cancelled',progress:0});else s.setProgress({status:'failed',progress:0,error:(error as Error).message});}
  finally{exportAbort.current=null;}}

 return <main className={'app platform-'+s.runtime?.platform+' '+''} onDragOver={e=>{if(e.dataTransfer.types.includes('Files'))e.preventDefault();}} onDrop={e=>{if(!e.dataTransfer.files.length)return;e.preventDefault();void window.dream.registerDropped([...e.dataTransfer.files]).then(paths=>attach(paths)).catch(error=>s.setError(error.message));}}>

 {s.route==='home'||!project?<HomeScreen projects={s.projects} value={homeInput} onChange={setHomeInput} attachments={homePaths.map(path=>({id:path,name:path.split(/[\\/]/).pop()!}))} onRemove={id=>setHomePaths(paths=>paths.filter(p=>p!==id))} onSubmit={()=>void create()} onUpload={()=>void attach()} onOpen={folder=>void s.open(folder)} busy={s.busy}/>:<><header className="workspace-header"><button className="icon-button" aria-label="Back to projects" onClick={()=>{player.current?.pause();s.setRoute('home');void s.refreshProjects();}}><ArrowLeft size={21}/></button><input className="project-title" aria-label="Project name" key={project.meta.id+project.meta.name} defaultValue={project.meta.name} onBlur={e=>{const name=e.target.value.trim();if(name&&name!==project.meta.name)void s.command({type:'rename',name});}} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}}/><span className="spacer"/><button className="icon-button" title="Undo" aria-label="Undo" disabled={!project.canUndo||active} onClick={()=>s.command({type:'undo'})}><Undo2 size={17}/></button><button className="icon-button" title="Redo" aria-label="Redo" disabled={!project.canRedo||active} onClick={()=>s.command({type:'redo'})}><Redo2 size={17}/></button><button className="button primary" disabled={!duration||active} onClick={()=>setDialog('export')}><Upload size={17}/>Export</button><ProfileMenu/></header>{<AIWorkspace key={project.meta.id} project={project} player={player} frame={s.frame} playing={s.playing} onFrame={s.setFrame} onPlaying={s.setPlaying} onSeek={seek} selected={s.selected} onSelect={s.setSelected} attachments={s.attachments} onAttachments={s.setAttachments} importFiles={s.importFiles} tab={s.sidebarTab} onTab={s.setSidebarTab} value={input} onChange={setInput} command={s.command} onSubmit={()=>void submit()} onRevise={text=>submit(text)} onImport={()=>void attach()} onError={s.setError} busy={s.busy} catalog={s.catalog}/>}</>}

 {s.error&&<div className="error-toast" role="alert"><p>{s.error}</p><button aria-label="Dismiss error" onClick={()=>s.setError(null)}><X size={17}/></button></div>}

 <SettingsLayer/>
 {signIn&&<SignInDialog onClose={()=>setSignIn(false)}/>}
 {files&&<FileAccessPanel onClose={()=>setFiles(false)} onImport={paths=>void attach(paths)} onError={s.setError} onGranted={()=>{const current=useEditor.getState().project;if(current?.aiStatus==='awaiting_file_permission'&&current.experience?.fileWait?.kind==='permission'){setFiles(false);void s.command({type:'resume'});}}}/>}

 {dialog==='export'&&project&&<div className="dialog-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget&&s.progress?.status!=='rendering')setDialog(null);}}><ExportDialog project={project} frame={s.frame} progress={s.progress} onClose={()=>{setDialog(null);if(s.progress?.status!=='rendering')s.setProgress(null);}} onExport={choices=>void exportVideo(choices)} onCancel={()=>{exportAbort.current?.abort();stopExports();void window.dream.cancelExport();}} onTimeline={()=>void exportVideo('timeline')} onShare={()=>setDialog('share')}/></div>}
 {dialog&&dialog!=='export'&&<div className="dialog-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget)setDialog(null);}}><section className="dialog" role="dialog" aria-label={dialog}><div className="dialog-header"><h2>{dialog==='share'?'Share your video':'Export video'}</h2><button className="icon-button" aria-label="Close dialog" onClick={()=>setDialog(null)}><X size={20}/></button></div>

 



 {dialog==='share'&&<><p>Upload your completed MP4 and create a viewing link.</p>{share&&<input className="share-url" readOnly value={share}/>}<div className="dialog-actions"><button className="button primary" onClick={async()=>{try{const result=await window.dream.shareExport();if(result)setShare(result.url);}catch(error){s.setError((error as Error).message);}}}><Share2 size={16}/>Create link</button>{share&&<button className="button secondary" onClick={()=>navigator.clipboard.writeText(share)}>Copy link</button>}</div></>}

 

 </section></div>}

 </main>;

}

