import {ComputerAccessPrompt} from '../files/ComputerAccessPrompt';
import {usePlayhead} from '../../store/playhead';
import {useEditor,stopRun} from '../../store/editor';
import {Conversation} from '../chat/Conversation';
import React,{useEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {selectionRefs} from '@dream/timeline';
import {MediaTile} from '../media/MediaTile';
import type {PlayerRef} from '../../engine/EngineView';
import {X,ArrowDown} from 'lucide-react';
import {WorkflowStateSchema,OutlineSchema} from '@dream/contracts';
import type {ProjectState} from '@dream/project-db';
import {ChatComposer} from '../chat/ChatComposer';
import {OutOfCredits} from '../billing/Upgrade';
import {GumboMark} from '../home/HomeScreen';
import {ProjectPlayer} from '../player/ProjectPlayer';
import {ManualTimeline} from '../../manual/ManualTimeline';
import {removeItems,splitItems,duplicateItems,manualItems,splitRemove,selectableIds,addAsset,transitionOps,nearestCut,transitionClip,transitionId,libraryOps,reason as manualReason,type LibraryDrop} from '../../manual/model';
import {TransitionsView} from '../editor/library/TransitionsView';
import {EffectsView,FiltersView,TextView,StickersView,CaptionsView} from '../editor/library/LibraryViews';
import {AssetsPanel} from '../editor/AssetsPanel';
import {PropertiesPanel} from '../editor/PropertiesPanel';
import {entranceSec} from '@dream/compositor';
import {PreviewHandles} from '../editor/PreviewHandles';
import {ShortcutsHelp} from '../editor/ShortcutsHelp';
import {typing} from '../../manual/shortcuts';
import type {SidebarTab} from '../../store/editor';
import '../editor/editor.css';
import type {Op,TimelineDocument} from '@dream/timeline';
import {ProjectMedia} from '../media/ProjectMedia';
import {TaskDock} from '../sidebar/TaskDock';
import {TaskPlanCard} from '../sidebar/TaskPlanCard';
import {FileChangeCard} from '../files/FileChangeCard';
import type {CommandFn} from '../../hooks/useProjectSession';
import {AgentCursor} from './AgentCursor';
import {ElementsPanel} from './ElementsPanel';
import {EditorActionsContext,type EditorActions} from './editor-actions';
import {editingActivity,editingTask} from '../../editing-language';
import {useStable} from '../../memo';
import {useAutoReport} from '../../improve';
export function AIWorkspace(p:{project:ProjectState;player:React.RefObject<PlayerRef|null>;frame:number;playing:boolean;onFrame:(n:number)=>void;onPlaying:(v:boolean)=>void;onSeek:(n:number)=>void;selected:string[];onSelect:(ids:string[])=>void;attachments:string[];onAttachments:(ids:string[])=>void;importFiles:(paths:string[])=>Promise<string[]>;tab:SidebarTab;onTab:(tab:SidebarTab)=>void;value?:string;onChange?:(v:string)=>void;command:CommandFn;onSubmit:()=>void;onRevise:(text:string)=>Promise<boolean>;onImport:()=>void;onError:(s:string)=>void;busy:boolean;catalog:any}){const layout=useEditor(s=>s.layout),editor=layout==='editor'&&p.project.aiStatus!=='running',[width,setWidth]=useState(Number(localStorage.getItem('dream-chat-width'))||34),[assetsWidth,setAssetsWidth]=useState(Number(localStorage.getItem('dream-editor-assets'))||24),[propsWidth,setPropsWidth]=useState(Number(localStorage.getItem('dream-editor-properties'))||22),[editorTimeline,setEditorTimeline]=useState(Number(localStorage.getItem('dream-editor-timeline'))||40),[help,setHelp]=useState(false),clipboard=useRef<{ids:string[];timeline:TimelineDocument}|null>(null),[timelineHeight,setTimelineHeight]=useState(Number(localStorage.getItem('dream-timeline-height'))||38),[preview,setPreview]=useState<TimelineDocument|null>(null);const active=p.project.aiStatus==='running',ready=!!p.project.experience?.firstDraftVersionId,scroll=useRef<HTMLDivElement>(null),workflow=WorkflowStateSchema.safeParse(p.project.workflow),outline=OutlineSchema.safeParse(p.project.outline);const [following,setFollowing]=useState(true);const selection=useMemo(()=>selectionRefs(p.project.timeline,p.project.footage,p.selected),[p.project.timeline,p.project.footage,p.selected]);const follow=useRef(true),commentary=useEditor(s=>s.commentary),pending=useEditor(s=>s.pending),permission=useEditor(s=>s.permission),model=useEditor(s=>s.model),sent=useRef<string|undefined>(undefined);
 useAutoReport(p.project);
 // Editing by hand: every change is one undoable version, made against the version it was based on. The agent sees it in
 // its next request; while the agent works, the timeline is locked.
 const locked=active||p.busy,t=p.project.timeline,f=p.project.footage,draft=useEditor(s=>s.draft);
 const shownDraft=draft?.timeline&&(active||draft.basedOn===p.project.versionId)?draft:null,playableDraft=shownDraft&&!shownDraft.assets?.length?shownDraft.timeline:undefined;
 const applyOps=useStable((ops:Op[],label:string,version?:string)=>ops.length?p.command({type:'apply',ops,label,expectedVersionId:version??useEditor.getState().project?.versionId??p.project.versionId,requestId:crypto.randomUUID(),snapToSpeech:false}):Promise.resolve());
 const lockedReason='Gumbo is editing. Stop it to change the timeline yourself.';
 // Change cards and the elements list pick things on the timeline (selected, playhead on them, lit up) and apply undoable changes.
 const editorActions=useMemo<EditorActions>(()=>({locked,
  // Showing a change does not select it: selecting would put it in the chat box as context for the next message.
  focus:(id,startSec)=>{if(startSec!==undefined)p.onSeek(Math.round(startSec*t.settings.fps));
   window.setTimeout(()=>{const block=id?stage.current?.querySelector<HTMLElement>(`[data-item-id="${CSS.escape(id)}"]`):null;if(!block)return;block.scrollIntoView({block:'nearest',inline:'center',behavior:'smooth'});block.dataset.aiTouched='true';window.setTimeout(()=>{delete block.dataset.aiTouched;},2200);},60);},
  apply:async(ops,label)=>{if(locked){p.onError(lockedReason);return false;}try{return !!await applyOps(ops,label);}catch(error){p.onError((error as Error).message);return false;}}}),[locked,t,p.onSeek]);
 // While the agent edits, the editor shows it working there (AgentCursor), as an agent using a computer would.
 // The run's phase can reach the window after its first change, so an edit request counts from the start (a plan or an
 // answer never does).
 // From the moment a message is sent (before the service confirms the run) the editor shows Gumbo at work and Stop.
 const working=active||!!pending,phase=p.project.experience?.activity?.phase,stage=useRef<HTMLElement>(null),driving=working;
 const liveStep=[...(p.project.experience?.activity?.events??[])].sort((a,b)=>b.sequence-a.sequence).find(e=>e.kind==='action'&&['running','drafting'].includes(e.status)),drivingLabel=liveStep?editingActivity(liveStep):pending&&!active?'Starting':phase==='planning'?'Planning':phase==='answering'?'Working on an answer':'Gumbo is thinking';
 // What the player says while Gumbo edits an empty canvas; worked out here so the player need not follow the activity.
 const currentAction=p.project.experience?.activity?.events?.findLast(e=>e.kind==='action'&&e.status==='running'),currentStep=p.project.experience?.steps?.findLast(step=>step.status==='running'),playerStatus=currentAction?editingActivity(currentAction):currentStep?editingTask(currentStep.label):'Putting your ideas in motion';
 const recentSteps=[...(p.project.experience?.activity?.events??[])].filter(e=>e.kind==='action'&&e.tool!=='finish').sort((a,b)=>a.sequence-b.sequence).slice(-4);
 const run=(make:()=>Op[],label:string)=>{if(locked){p.onError(lockedReason);return;}try{void applyOps(make(),label);}catch(error){p.onError((error as Error).message);}};
 // Stable, so the timeline (kept from re-rendering while Gumbo streams) always runs the current selection's action.
 const remove=useStable(()=>run(()=>removeItems(t,f,p.selected),'Delete selection'));
 const split=useStable(()=>run(()=>splitItems(t,f,p.selected.length?p.selected:manualItems(t,f).filter(i=>!t.trackSettings?.[i.track]?.locked).map(i=>i.id),now()),'Split at playhead'));
 const duplicate=useStable(()=>run(()=>duplicateItems(t,f,p.selected),'Duplicate selection'));
 const seek=useStable((frame:number)=>p.onSeek(frame)),attach=useStable((ids:string[])=>{p.onAttachments([...new Set([...p.attachments,...ids])]);p.onTab('chat');});
 // Read when used: while playing the workspace does not re-render, so its frame is where playback started.
 const now=()=>usePlayhead.getState().frame/t.settings.fps;
 // Editing keys after OpenCut's (manual/shortcuts.ts): S or Ctrl+B splits, Q and W split and remove a side, Ctrl+C and
 // Ctrl+V copy and paste at the playhead, Ctrl+A selects everything, ? lists them all.
 useEffect(()=>{const key=(e:KeyboardEvent)=>{if(typing(e)||document.querySelector('.dialog-backdrop'))return;const mod=e.ctrlKey||e.metaKey,k=e.key.toLowerCase(),plain=!mod&&!e.altKey&&!e.shiftKey;
  if((e.key==='Delete'||e.key==='Backspace')&&p.selected.length){e.preventDefault();remove();}
  else if(mod&&k==='b'||plain&&k==='s'){e.preventDefault();split();}
  else if(plain&&(k==='q'||k==='w')){e.preventDefault();run(()=>splitRemove(t,f,p.selected,now(),k==='q'?'left':'right'),k==='q'?'Split and remove left':'Split and remove right');}
  else if(mod&&k==='d'&&p.selected.length){e.preventDefault();duplicate();}
  else if(mod&&k==='c'&&p.selected.length&&!window.getSelection()?.toString()){e.preventDefault();clipboard.current={ids:[...p.selected],timeline:t};}
  else if(mod&&k==='v'&&clipboard.current){e.preventDefault();const copied=clipboard.current;run(()=>duplicateItems(copied.timeline,f,copied.ids,now(),t),'Paste');}
  else if(mod&&k==='a'){e.preventDefault();p.onSelect(selectableIds(t,f));}
  else if(e.key==='?'){e.preventDefault();setHelp(v=>!v);}};
  window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key);},[t,f,p.selected,p.frame,locked]);
 // A transition clicked in the library goes on the selected cut, into the selected clip, or on the cut nearest the playhead.
 const addTransition=(type:string)=>{const one=p.selected.length===1?p.selected[0]:undefined,picked=one?transitionClip(one)??(t.spine.findIndex(c=>c.id===one)>0?one:undefined):undefined,clipId=picked??nearestCut(t,f,now())?.id;
  if(!clipId){p.onError('Transitions go on a cut between two clips on the main track.');return;}run(()=>transitionOps(t,f,clipId,type),'Add transition');p.onSelect([transitionId(clipId)]);};
 // A library piece clicked: text and stickers at the playhead; an effect over the selected clip and a filter on its own
 // picture (else both at the playhead for three seconds). What it added is selected, ready for the properties panel.
 const addPiece=(drop:LibraryDrop)=>{if(locked){p.onError(lockedReason);return;}const one=p.selected.length===1?p.selected[0]:undefined,clip=one&&t.spine.some(c=>c.id===one)?one:undefined;
  try{const ops=libraryOps(t,f,drop,now(),(drop.kind==='effect'||drop.kind==='filter')&&clip?{clipId:clip,onClip:drop.kind==='filter'}:{}),added=ops.find(o=>o.type==='add_item');
   // Text and stickers come in with an animation, so at their first frame there is nothing to see yet: the playhead moves to
   // where the entrance has finished, showing what was added with its handles, as CapCut plays a template once.
   void applyOps(ops,'Add '+drop.kind).then(()=>{if(added?.type!=='add_item')return;p.onSelect([added.item.id]);
    if(drop.kind==='text'||drop.kind==='sticker'){const fps=t.settings.fps,sec=entranceSec(added.item.params,added.item.durationSec??3,drop.kind==='sticker');if(sec>0)p.onSeek(Math.round((now()+sec)*fps)+1);}});}catch(error){p.onError((error as Error).message);}};
 const chooseCaptions=(style:string|null)=>run(()=>[{type:'set_captions',captions:style?{style:style as 'clean',params:t.captions?.params??{},overrides:t.captions?.overrides??[]}:null,reason:manualReason}],style?'Caption style':'Turn captions off');
 // The editor's + on a media card: video and photos join the main track at the playhead, audio goes to music.
 const addMedia=(assetId:string)=>{const asset=f.assets.find(a=>a.id===assetId);if(!asset)return;run(()=>addAsset(t,f,assetId,asset.kind==='audio'?'music:0':'video',Math.round(now()*t.settings.fps)/t.settings.fps),'Add media');};
 // Sending always jumps to the newest message; after that the chat follows new output while you are at the bottom.
 useLayoutEffect(()=>{if(pending&&pending.requestId!==sent.current){sent.current=pending.requestId;follow.current=true;setFollowing(true);}if(follow.current&&scroll.current)scroll.current.scrollTop=scroll.current.scrollHeight;},[pending?.requestId,commentary,p.project.messages.length,p.project.experience?.steps,p.project.experience?.activity?.events,p.project.aiStatus,p.project.experience?.fileWait?.proposal?.id,p.project.taskPlan,p.project.outline,p.tab,layout]);
 // Content that grows on its own (a streaming note, an image loading, a table filling in) stays pinned to the bottom too.
 useEffect(()=>{const node=scroll.current,content=node?.firstElementChild;if(!node||!content)return;const observer=new ResizeObserver(()=>{if(follow.current)node.scrollTop=node.scrollHeight;});observer.observe(content);return()=>observer.disconnect();},[p.tab,layout]);
 // The pieces both layouts show: the chat (conversation and composer), media, elements, the player and the timeline.
 const chatView=<div className="sidebar-scroll" ref={scroll} onScroll={e=>{const el=e.currentTarget;follow.current=el.scrollHeight-el.scrollTop-el.clientHeight<100;setFollowing(follow.current);}}><div className="chat-content">{p.project.history?.messagesBefore&&<button className="text-button" onClick={async()=>{const result=await p.command({type:'history_page',kind:'messages',before:p.project.history!.messagesBefore!,limit:50});if(result?.items){const {useEditor}=await import('../../store/editor');const current=useEditor.getState().project!;useEditor.getState().setProject({...current,messages:[...result.items,...current.messages],history:{...current.history!,messagesBefore:result.nextBefore}});}}}>Load earlier messages</button>}<Conversation project={p.project}/>{!p.project.messages.length&&<div className="chat-welcome"><GumboMark/><h3>Let’s make something worth watching.</h3><p>Describe your edit, or add media to get started.</p></div>}{!!p.project.taskPlan&&p.project.aiStatus==='awaiting_approval'&&<TaskPlanCard proposal={p.project.taskPlan} model={model} busy={active||p.busy} onRevise={p.onRevise} onApprove={(plan,expectedVersionId,expectedPlanRevision,runModel)=>{if(useEditor.getState().permission==='plan')useEditor.getState().setPermission('auto');return p.command({type:'approve_plan',plan,expectedVersionId,expectedPlanRevision,requestId:crypto.randomUUID(),model:runModel});}} onSave={(document,expectedRevision,expectedVersionId)=>p.command({type:'save_plan_draft',document,expectedRevision,expectedVersionId})}/>} {outline.success&&p.project.aiStatus==='awaiting_approval'&&<div className="outline-card"><h3>{outline.data.goal}</h3>{outline.data.beats.map(beat=><p key={beat.id}>{beat.purpose} · {beat.targetSec}s</p>)}<button className="button primary" onClick={()=>p.command({type:'approve',outline:outline.data,expectedVersionId:p.project.versionId,requestId:crypto.randomUUID()})}>Approve & create</button></div>}{p.project.aiStatus==='awaiting_file_permission'&&(p.project.experience?.fileWait?.proposal?<FileChangeCard proposal={p.project.experience.fileWait.proposal} onError={p.onError}/>:<ComputerAccessPrompt command={p.command}/>) }{p.project.aiStatus==='interrupted'&&p.project.experience?.bootstrap?.error&&<p className="turn-error" role="status">{p.project.experience.bootstrap.error}</p>}</div>{!following&&<button className="jump-latest" aria-label="Jump to latest" onClick={()=>{follow.current=true;setFollowing(true);scroll.current?.scrollTo({top:scroll.current.scrollHeight,behavior:'smooth'});}}><ArrowDown size={14}/></button>}</div>;
 const composer=<><TaskDock project={p.project}/><OutOfCredits/><ChatComposer value={p.value} onChange={p.onChange} onSubmit={p.onSubmit} onUpload={p.onImport} onMedia={()=>p.onTab('media')} attachments={p.attachments.map(id=>{const asset=p.project.footage.assets.find(a=>a.id===id);return{id,name:asset?.filename??'Media',asset};})} onRemove={id=>p.onAttachments(p.attachments.filter(i=>i!==id))} busy={p.busy} active={working} onStop={stopRun} permission={permission} onPermission={useEditor.getState().setPermission} model={model} onModel={useEditor.getState().setModel} context={p.selected.length>0&&<div className="selection-strip" aria-label="Selected timeline items"><div className="selection-strip-items">{selection.map(ref=><MediaTile key={ref.id} asset={p.project.footage.assets.find(a=>a.id===ref.assetId)} label={ref.label} srcIn={ref.kind==='caption'?undefined:ref.srcIn} srcOut={ref.srcOut} onRemove={()=>p.onSelect(p.selected.filter(id=>id!==ref.id))}/>)}</div><button type="button" aria-label="Clear selection" onClick={()=>p.onSelect([])}><X size={12}/></button></div>}/></>;
 const elementsView=<div className="sidebar-scroll"><ElementsPanel project={p.project} selected={p.selected}/></div>;
 const playerView=<ProjectPlayer manual={editor} overlay={editor&&!shownDraft?<PreviewHandles timeline={preview??t} base={t} versionId={p.project.versionId} footage={f} frame={p.frame} selected={p.selected} locked={locked} lockedReason={lockedReason} onSelect={p.onSelect} onPreview={setPreview} onApply={applyOps} onError={p.onError}/>:undefined} project={p.project} timeline={preview??playableDraft} player={p.player} frame={p.frame} playing={p.playing} onFrame={p.onFrame} onPlaying={p.onPlaying} command={p.command} working={active&&p.project.experience?.activity?.phase==='editing'} status={playerStatus}/>;
 const timelineView=<ManualTimeline label="AI timeline" draft={shownDraft} live={!!shownDraft&&active} project={p.project} frame={p.frame} selected={p.selected} disabled={locked} lockedReason={lockedReason} onSelect={p.onSelect} onSeek={seek} onApply={applyOps} onPreview={setPreview} onSplit={split} onDuplicate={duplicate} onDelete={remove} onError={p.onError} onAttach={attach}/>;
 const cursorView=<AgentCursor active={driving} label={drivingLabel} steps={recentSteps} stage={stage} timeline={shownDraft?.timeline??t} footage={shownDraft?.assets?.length?{...f,assets:[...f.assets,...shownDraft.assets.filter(a=>!f.assets.some(b=>b.id===a.id))]}:f} onStop={stopRun}/>;
 const helpView=help&&<ShortcutsHelp onClose={()=>setHelp(false)}/>;
 if(editor){
  // OpenCut's layout: assets (with Gumbo's chat as the first tab), preview and properties over a full-width timeline.
  const drag=(set:(n:number)=>void,key:string,value:(e:React.PointerEvent<HTMLDivElement>,box:DOMRect)=>number,min:number,max:number)=>({onPointerDown:(e:React.PointerEvent<HTMLDivElement>)=>e.currentTarget.setPointerCapture(e.pointerId),onPointerMove:(e:React.PointerEvent<HTMLDivElement>)=>{if(!e.currentTarget.hasPointerCapture(e.pointerId))return;const n=Math.max(min,Math.min(max,value(e,e.currentTarget.closest('.editor-layout')!.getBoundingClientRect())));set(n);localStorage.setItem(key,String(n));}});
  const tabs:SidebarTab[]=['chat','media','text','stickers','effects','transitions','filters','captions','elements'],tab=tabs.includes(p.tab)?p.tab:'media';
  const selectedClip=p.selected.length===1?t.spine.find(c=>c.id===p.selected[0]):undefined;
  return <EditorActionsContext.Provider value={editorActions}><div className="ai-workspace editor-workspace"><section ref={stage} className={'ai-stage editor-layout'+(driving?' agent-driving':'')} style={{'--assets-width':`${assetsWidth}%`,'--properties-width':`${propsWidth}%`,'--timeline-height':`${editorTimeline}%`} as React.CSSProperties}>{cursorView}
   <div className="editor-top with-properties">
    <AssetsPanel tab={tab} onTab={p.onTab} tabs={tabs}>{tab==='chat'?<div className="editor-chat">{chatView}{composer}</div>:tab==='elements'?elementsView:tab==='transitions'?<TransitionsView disabled={locked} onApply={addTransition}/>:tab==='text'?<TextView disabled={locked} onAdd={addPiece}/>:tab==='stickers'?<StickersView disabled={locked} onAdd={addPiece}/>:tab==='effects'?<EffectsView disabled={locked} onAdd={addPiece}/>:tab==='filters'?<FiltersView disabled={locked} onAdd={addPiece} current={selectedClip?.framing?.filter}/>:tab==='captions'?<CaptionsView disabled={locked} current={t.captions?.style} onChoose={chooseCaptions}/>:<div className="sidebar-scroll"><ProjectMedia project={p.project} selected={p.attachments} onSelect={p.onAttachments} onImport={p.onImport} onImportFiles={paths=>void p.importFiles(paths).catch(error=>p.onError((error as Error).message))} command={p.command} onAdd={locked?undefined:addMedia}/></div>}</AssetsPanel>
    <div className="editor-resizer" role="separator" aria-label="Resize assets" {...drag(setAssetsWidth,'dream-editor-assets',(e,box)=>(e.clientX-box.left)/box.width*100,16,45)}/>
    <div className="editor-preview">{playerView}</div>
    <div className="editor-resizer" role="separator" aria-label="Resize properties" {...drag(setPropsWidth,'dream-editor-properties',(e,box)=>(box.right-e.clientX)/box.width*100,16,40)}/>
    <PropertiesPanel project={p.project} timeline={preview??t} frame={p.frame} selected={p.selected} locked={locked} lockedReason={lockedReason} onApply={applyOps} onPreview={setPreview} onError={p.onError}/>
   </div>
   <div className="timeline-resizer" role="separator" aria-label="Resize timeline" {...drag(setEditorTimeline,'dream-editor-timeline',(e,box)=>(box.bottom-e.clientY)/box.height*100,20,70)}/>
   {timelineView}{helpView}
  </section></div></EditorActionsContext.Provider>;
 }
 // Gumbo's layout has three tabs; an editor library tab (open when an edit moved here from the editor) shows the chat.
 const gumboTab=(['chat','media','elements'] as SidebarTab[]).includes(p.tab)?p.tab:'chat';
 return <EditorActionsContext.Provider value={editorActions}><div className="ai-workspace" style={{'--chat-width':`${width}%`} as React.CSSProperties}><aside className="sidebar"><header className="sidebar-header"><div className="sidebar-tabs"><button className={gumboTab==='chat'?'active':''} onClick={()=>p.onTab('chat')}>Chat</button><button className={gumboTab==='media'?'active':''} onClick={()=>p.onTab('media')}>Media <small>{p.project.footage.assets.length}</small></button><button className={gumboTab==='elements'?'active':''} onClick={()=>p.onTab('elements')}>Elements</button></div></header>{gumboTab==='elements'?elementsView:gumboTab==='media'?<div className="sidebar-scroll"><ProjectMedia project={p.project} selected={p.attachments} onSelect={p.onAttachments} onImport={p.onImport} onImportFiles={paths=>void p.importFiles(paths).catch(error=>p.onError((error as Error).message))} command={p.command}/></div>:chatView}
 {composer}</aside><div className="chat-resizer" role="separator" aria-label="Resize chat" onPointerDown={e=>{e.currentTarget.setPointerCapture(e.pointerId);}} onPointerMove={e=>{if(e.currentTarget.hasPointerCapture(e.pointerId)){const value=Math.max(20,Math.min(60,(e.clientX-e.currentTarget.parentElement!.getBoundingClientRect().left)/e.currentTarget.parentElement!.clientWidth*100));setWidth(value);localStorage.setItem('dream-chat-width',String(value));}}}/><section ref={stage} className={'ai-stage '+(!ready?'first-draft':'')+(driving?' agent-driving':'')} style={{'--timeline-height':`${timelineHeight}%`} as React.CSSProperties}>{cursorView}{playerView}{(ready||p.project.footage.assets.length>0)&&<><div className="timeline-resizer" role="separator" aria-label="Resize timeline" onPointerDown={e=>e.currentTarget.setPointerCapture(e.pointerId)} onPointerMove={e=>{if(!e.currentTarget.hasPointerCapture(e.pointerId))return;const stage=e.currentTarget.parentElement!.getBoundingClientRect(),value=Math.max(15,Math.min(80,(stage.bottom-e.clientY)/stage.height*100));setTimelineHeight(value);localStorage.setItem('dream-timeline-height',String(value));}}/>{timelineView}</>}</section>{helpView}</div></EditorActionsContext.Provider>;
}
