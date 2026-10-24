import {editingChanges} from './editing-language';
import React,{useEffect,useMemo,useRef,useState} from 'react';

import type {PlayerRef} from './engine/EngineView';

import {resolve} from '@dream/timeline';

import {ArrowLeft,Undo2,Redo2,SlidersHorizontal,Upload,History,X,Download,Check,Share2,FolderOpen,Lock,Scissors} from 'lucide-react';

import {useProjectSession} from './hooks/useProjectSession';

import {useEditor} from './store/editor';
import {useStable} from './memo';
import {typing} from './manual/shortcuts';
import {approvesPlan} from '@dream/contracts';
import {selectionRefs} from '@dream/timeline';

import {HomeScreen,GumboMark} from './components/home/HomeScreen';
import {useDraft,setDraft} from './store/draft';

import {AIWorkspace} from './components/workspace/AIWorkspace';
import {ExportDialog,type ExportChoices} from './components/export/ExportDialog';
import {ShareDialog} from './components/export/ShareDialog';
import {runExport,stopExports} from './engine/export-job';
import {useChatShortcuts} from './shortcuts';
import {useTheme} from './theme';
import {ProfileMenu,SettingsLayer} from './components/settings/SettingsMenu';
import {UpgradeLayer} from './components/billing/Upgrade';
import {WelcomeLayer} from './components/billing/Welcome';
import {OnboardingLayer} from './components/onboarding/Onboarding';



import {FileAccessPanel} from './components/files/FileAccessPanel';
import {SignInDialog} from './components/account/SignInDialog';
import {requireSignIn} from './account';
import {homePaths as storedHomePaths,keepHomePaths} from './first-ask';



/** Gumbo's chat layout or the editor's (OpenCut's: assets, preview and properties over a full-width timeline), as two
 * words in the header. Both edit the same timeline; the choice is remembered. */
/** Gumbo's layout or the editor, centred in the header. While Gumbo is editing the editor is closed: the workspace shows
 * Gumbo's layout, and the editor comes back by itself when the edit ends if it was the layout chosen. */
function LayoutSwitch({locked}:{locked:boolean}){const layout=useEditor(s=>locked?'gumbo':s.layout);
 const choose=(next:'gumbo'|'editor')=>{const store=useEditor.getState();if(next===store.layout)return;store.setLayout(next);
  // The editor opens on the media; Gumbo's layout has no library tabs, so it goes back to the chat from one.
  if(next==='editor'&&store.sidebarTab==='chat')store.setSidebarTab('media');if(next==='gumbo'&&!['chat','media','elements'].includes(store.sidebarTab))store.setSidebarTab('chat');};
 return <div className={'layout-switch'+(locked?' locked':'')} role="radiogroup" aria-label="Layout">{(['gumbo','editor'] as const).map(id=>{const closed=locked&&id==='editor';
  return <button key={id} type="button" role="radio" aria-checked={layout===id} aria-disabled={closed||undefined} title={closed?'The editor opens when Gumbo finishes editing':undefined} onClick={()=>{if(!closed)choose(id);}}>
   {id==='gumbo'?<span className="layout-switch-mark"><GumboMark/></span>:closed?<Lock size={14}/>:<Scissors size={14}/>}{id==='gumbo'?'Gumbo':'Editor'}</button>;})}</div>;}

export function App(){const s=useProjectSession(),player=useRef<PlayerRef>(null),exportAbort=useRef<AbortController|null>(null),[dialog,setDialog]=useState<'export'|'share'|null>(null),[files,setFiles]=useState(false),setInput=setDraft,[homeInput,setHomeInput]=useState(''),[homePaths,setHomePaths]=useState<string[]>(storedHomePaths),[homeIncoming,setHomeIncoming]=useState<string[]>([]);
 const [signIn,setSignIn]=useState(false);
 // The home box's files outlive the page: signing in on the web leaves it and comes back.
 useEffect(()=>keepHomePaths(homePaths),[homePaths]);
 // Files chosen for the home box show there at once, while the web copies them in (media.incoming; ProjectMedia does the same).
 const route=useRef(s.route);route.current=s.route;
 useEffect(()=>window.dream.onEvent((event:any)=>{if(event.type!=='media.incoming'||route.current!=='home')return;setHomeIncoming(old=>event.payload?.failed?[]:[...old,...(event.payload?.files??[]).map((f:{name:string})=>f.name)]);}),[]);// A request picked in the onboarding or the welcome to a plan goes into the home screen's box.
 useEffect(()=>{const prompt=(e:Event)=>{setHomeInput(String((e as CustomEvent).detail??''));s.setRoute('home');};window.addEventListener('gumbo:prompt',prompt);return()=>window.removeEventListener('gumbo:prompt',prompt);},[]);
 useEffect(()=>{const open=()=>setSignIn(true);window.addEventListener('dream:sign-in',open);return()=>window.removeEventListener('dream:sign-in',open);},[]);
 const returned=useEditor(state=>state.returned);useEffect(()=>{if(returned!==null){setInput(value=>value.trim()?value:returned);useEditor.setState({returned:null});}},[returned]);const creating=useRef(false),sending=useRef(false),project=s.project,active=project?.aiStatus==='running',timeline=project?.timeline,footage=project?.footage;
 // Worked out once per edit: while Gumbo streams, the window draws again for every word.
 const duration=useMemo(()=>timeline&&footage?resolve(timeline,footage).durationSec:0,[timeline,footage]);

 useTheme();
 // Stable, as are the workspace's other handlers, so the workspace (kept from re-rendering) is not drawn again for each
 // change to the window around it: an export's progress, a dialog, the home screen's box.
 const seek=useStable((frame:number)=>{const current=useEditor.getState().project;if(!current)return;const n=Math.max(0,Math.min(Math.max(1,resolve(current.timeline,current.footage).durationInFrames)-1,frame));s.setFrame(n);player.current?.seekTo(n);});

 async function create(){if(creating.current||s.busy||!homeInput.trim())return;creating.current=true;try{if(!await requireSignIn())return;const {permission,model}=useEditor.getState(),p=await s.create({requestId:crypto.randomUUID(),text:homeInput.trim(),paths:homePaths,intent:permission,model});if(p){setHomeInput('');setHomePaths([]);setInput('');}}finally{creating.current=false;}}

 async function attach(paths?:string[]){try{if(paths){const documents=paths.filter(path=>!(/\.(mp4|mov|webm|mkv|m4v|avi|mts|m2ts|3gp|mpe?g|wmv|wav|mp3|m4a|aac|flac|ogg|png|jpe?g|webp|heic|heif|avif|gif)$/i.test(path)));if(documents.length){const note='Use these files for this edit: '+documents.map(path=>JSON.stringify(path)).join(', ');if(s.route==='home')setHomeInput(old=>old+(old?'\n':'')+note);else setInput(old=>old+(old?'\n':'')+note);paths=paths.filter(path=>!documents.includes(path));if(!paths.length)return;}}if(s.route==='home'){try{const selected=paths??await window.dream.pickMedia();setHomePaths(old=>[...new Set([...old,...selected])]);}finally{setHomeIncoming([]);}}else{const ids=await s.importFiles(paths);s.setAttachments([...new Set([...useEditor.getState().attachments,...ids])]);}}catch(error){s.setError((error as Error).message);}}

 // Every message is a new request; after a stop, the assistant decides whether it continues the stopped work.
 // The message shows and the composer clears at once; a failed send puts the text back.
 // A change asked for from a plan card sends its own text and leaves the composer alone.
 // The sign-in check is awaited before the box clears: a second click in that moment sent the message twice.
 async function submit(override?:string){const text=(override??useDraft.getState().text).trim();if(!project||!text||active||s.busy||sending.current)return false;sending.current=true;let signedIn=false;try{signedIn=await requireSignIn();}finally{sending.current=false;}if(!signedIn)return false;const assetIds=override===undefined?s.attachments:[],store=useEditor.getState(),requestId=crypto.randomUUID();store.setPending({requestId,text,assetIds,selection:selectionRefs(project.timeline,project.footage,s.selected),createdAt:new Date().toISOString()});if(override===undefined){setInput('');s.setAttachments([]);}s.setSidebarTab('chat');
 // A go-ahead for a waiting plan approves it, and like leaving plan mode the composer goes back to editing automatically.
 const approval=project.aiStatus==='awaiting_approval'&&approvesPlan(text);if(approval&&store.permission==='plan')store.setPermission('auto');
 const result=await s.command({type:'message',text,selection:s.selected,assetIds,intent:approval?'auto':store.permission,model:store.model,requestId});if(!result&&useEditor.getState().pending?.requestId===requestId){useEditor.getState().setPending(null);if(override===undefined){setInput(text);s.setAttachments(assetIds);}}return !!result;}

 // Redo under a finished request sends that request again (chat/TurnActions).
 useEffect(()=>{const send=(e:Event)=>{void submit(String((e as CustomEvent).detail??''));};window.addEventListener('gumbo:send',send);return()=>window.removeEventListener('gumbo:send',send);});
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if(s.route!=='ai'||dialog||files||typing(e))return;if((e.target as HTMLElement).closest('button,summary')&&(e.code==='Space'||e.key==='Enter'))return;const mod=e.ctrlKey||e.metaKey,key=e.key.toLowerCase(),fps=project?.timeline.settings.fps??30;
  // Playback keys as OpenCut has them (manual/shortcuts.ts): Space or K plays, J and L step a second, arrows a frame
  // (Shift: five seconds), Home and End jump to the ends.
  if(e.code==='Space'||!mod&&!e.altKey&&key==='k'){e.preventDefault();player.current?.toggle();}else if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();seek(s.frame+(e.key==='ArrowRight'?1:-1)*(e.shiftKey?5*fps:1));}else if(!mod&&!e.altKey&&(key==='j'||key==='l')){e.preventDefault();seek(s.frame+(key==='l'?fps:-fps));}else if(e.key==='Home'||e.key==='End'){e.preventDefault();seek(e.key==='Home'?0:Number.MAX_SAFE_INTEGER);}else if(mod&&key==='z'){e.preventDefault();void s.command({type:e.shiftKey?'redo':'undo'});}else if(mod&&key==='y'){e.preventDefault();void s.command({type:'redo'});}else if(e.key==='Escape')s.setSelected([]);};window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[s.route,s.frame,dialog,files,project?.versionId,active]);

 const sendDraft=useStable(()=>void submit()),revise=useStable((text:string)=>submit(text)),importMedia=useStable(()=>void attach());
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

 {s.route==='home'||!project?<HomeScreen projects={s.projects} value={homeInput} onChange={setHomeInput} attachments={[...homePaths.map(path=>({id:path,name:path.split(/[\\/]/).pop()!})),...homeIncoming.map(name=>({id:'incoming:'+name,name:name+' · adding…'}))]} onRemove={id=>setHomePaths(paths=>paths.filter(p=>p!==id))} onSubmit={()=>void create()} onUpload={()=>void attach()} onOpen={folder=>void s.open(folder)} onProjectAction={async(project,action)=>{try{await window.dream.projectAction(project.id,action);await s.refreshProjects();}catch(e){s.setError((e as Error).message.replace(/^Error invoking remote method '[^']+': (Error: )?/,''));}}} busy={s.busy}/>:<><header className="workspace-header"><button className="icon-button" aria-label="Back to projects" onClick={()=>{player.current?.pause();s.setRoute('home');void s.refreshProjects();}}><ArrowLeft size={21}/></button><input className="project-title" aria-label="Project name" key={project.meta.id+project.meta.name} defaultValue={project.meta.name} onBlur={e=>{const name=e.target.value.trim();if(name&&name!==project.meta.name)void s.command({type:'rename',name});}} onKeyDown={e=>{if(e.key==='Enter')e.currentTarget.blur();}}/><LayoutSwitch locked={active}/><span className="spacer"/><button className="icon-button" title="Undo" aria-label="Undo" disabled={!project.canUndo||active} onClick={()=>s.command({type:'undo'})}><Undo2 size={17}/></button><button className="icon-button" title="Redo" aria-label="Redo" disabled={!project.canRedo||active} onClick={()=>s.command({type:'redo'})}><Redo2 size={17}/></button><button className="button primary" disabled={!duration||active} onClick={()=>setDialog('export')}><Upload size={17}/>Export</button><ProfileMenu/></header>{<AIWorkspace key={project.meta.id} project={project} player={player} frame={s.frame} playing={s.playing} onFrame={s.setFrame} onPlaying={s.setPlaying} onSeek={seek} selected={s.selected} onSelect={s.setSelected} attachments={s.attachments} onAttachments={s.setAttachments} importFiles={s.importFiles} tab={s.sidebarTab} onTab={s.setSidebarTab} command={s.command} onSubmit={sendDraft} onRevise={revise} onImport={importMedia} onError={s.setError} busy={s.busy} catalog={s.catalog}/>}</>}

 {s.error&&<div className="error-toast" role="alert"><p>{s.error}</p><button aria-label="Dismiss error" onClick={()=>s.setError(null)}><X size={17}/></button></div>}

 <SettingsLayer/><UpgradeLayer/><WelcomeLayer/><OnboardingLayer/>
 {signIn&&<SignInDialog onClose={()=>setSignIn(false)}/>}
 {files&&<FileAccessPanel onClose={()=>setFiles(false)} onImport={paths=>void attach(paths)} onError={s.setError} onGranted={()=>{const current=useEditor.getState().project;if(current?.aiStatus==='awaiting_file_permission'&&current.experience?.fileWait?.kind==='permission'){setFiles(false);void s.command({type:'resume'});}}}/>}

 {dialog==='export'&&project&&<div className="dialog-backdrop" onMouseDown={e=>{if(e.target===e.currentTarget&&s.progress?.status!=='rendering')setDialog(null);}}><ExportDialog project={project} frame={s.frame} progress={s.progress} onClose={()=>{setDialog(null);if(s.progress?.status!=='rendering')s.setProgress(null);}} onExport={choices=>void exportVideo(choices)} onCancel={()=>{exportAbort.current?.abort();stopExports();void window.dream.cancelExport();}} onTimeline={()=>void exportVideo('timeline')} onShare={()=>setDialog('share')}/></div>}
 {dialog==='share'&&project&&<ShareDialog project={project} onClose={()=>setDialog(null)}/>}

 </main>;

}

