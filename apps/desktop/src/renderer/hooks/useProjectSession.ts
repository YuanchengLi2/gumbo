import {acceptRunActivity,acceptUsage} from '../store/editor';
import {useCallback,useEffect,useState} from 'react';
import type {Command,ProjectSummary,InitialRequest,ExportProgress,RuntimeStatus} from '@dream/contracts';
import {useEditor,mergeProjectDelta} from '../store/editor';
export type CommandFn=(command:Command)=>Promise<any>;
export function useProjectSession(){
 const s=useEditor(),[projects,setProjects]=useState<ProjectSummary[]>([]),[runtime,setRuntime]=useState<RuntimeStatus|null>(null),[progress,setProgress]=useState<ExportProgress|null>(null),[catalog,setCatalog]=useState<any>({scores:[],sfx:[]});
 const refreshProjects=useCallback(()=>window.dream.projects().then(setProjects).catch(error=>useEditor.getState().setError(error.message)),[]);
 const command:CommandFn=useCallback(async c=>{const store=useEditor.getState();store.setBusy(true);try{const result=await window.dream.command(c);if(result?.timeline)store.setProject(result);return result;}catch(error){store.setError((error as Error).message);return undefined;}finally{store.setBusy(false);}},[]);
 // Scenes that fail while playing in the player or a chat preview report back, so the agent sees the error next step.
 useEffect(()=>{
  const seen=new Set<string>();
  const report=(event:Event)=>{const detail=(event as CustomEvent).detail??{},draft=typeof detail.draft==='string'?/\/draft\/([a-f0-9]{16,64})\//.exec(detail.draft)?.[1]:undefined,key=JSON.stringify([detail.revisionId??draft??detail.assetId,detail.message]);
   if(!detail.message||seen.has(key))return;seen.add(key);void window.dream.command({type:'scene_error',assetId:draft?undefined:detail.assetId,revisionId:draft?undefined:detail.revisionId,draft,message:String(detail.message).slice(0,4000),stack:detail.stack?String(detail.stack).slice(0,16000):undefined}).catch(()=>{});};
  window.addEventListener('dream:scene-error',report);return()=>window.removeEventListener('dream:scene-error',report);
 },[]);
 useEffect(()=>{void window.dream.command({type:'state'}).then(s.setProject).catch(()=>{});void refreshProjects();void window.dream.runtime().then(setRuntime);void window.dream.catalog().then(setCatalog);return window.dream.onEvent(event=>{
  const current=useEditor.getState().project;if(event.projectId&&current&&event.projectId!==current.meta.id&&event.type!=='state')return;
  if(event.type==='state')s.setProject(event.payload as any);
  if(event.type==='workspace.draft'){const next=(event.payload as any).draft,last=useEditor.getState().draft;useEditor.getState().setDraft(!next?null:next.timeline?next:last?{...last,error:next.error,hash:next.hash}:null);}
  if(event.type==='state.delta'&&!mergeProjectDelta(event.payload as any))void window.dream.command({type:'state'}).then(s.setProject);
  if(event.turnId&&current?.experience?.turnId&&event.turnId!==current.experience.turnId&&event.type.startsWith('ai.'))return;
  if(event.type==='ai.workflow'){const p=useEditor.getState().project;if(p)s.setProject({...p,workflow:event.payload});}
  if(event.type==='ai.tasks'){const p=useEditor.getState().project;if(p?.experience)s.setProject({...p,experience:{...p.experience,activity:{steps:[],status:p.aiStatus,changes:[],...p.experience.activity,tasks:(event.payload as any).tasks}}});}
  if(event.type==='ai.activity')acceptRunActivity((event.payload as any).turnId,(event.payload as any).event);
  if(event.type==='ai.usage')acceptUsage(event.payload as any);
  if(event.type==='ai.commentary')useEditor.getState().setCommentary(event.payload as any);
  if(event.type==='ai.status'){const p=useEditor.getState().project;if(p)s.setProject({...p,aiStatus:(event.payload as any).status});}
  if(event.type==='ai.step'){const p=useEditor.getState().project;if(p){const step=event.payload as any,steps=[...(p.experience?.steps??[])],index=steps.findIndex(i=>(i.id??i.label)===(step.id??step.label));if(index<0)steps.push(step);else steps[index]=step;const activity={steps:[],status:p.aiStatus,changes:[],...p.experience?.activity},events=[...(activity.events??[])],id=step.id??step.label,found=events.find(i=>i.id===id&&i.kind==='action');if(found){found.text=step.label;found.status=step.status;}else events.push({id,sequence:events.length,kind:'action',text:step.label,status:step.status});s.setProject({...p,experience:{firstDraftVersionId:p.experience?.firstDraftVersionId??null,...p.experience,steps,activity:{...activity,events}}});}}
  if(['ai.error','media.error','account.error'].includes(event.type))s.setError((event.payload as any).message);
  // A request that failed before it was saved stops showing as sent.
  if(event.type==='ai.error'){const pending=useEditor.getState().pending;if(pending)useEditor.setState({pending:null,returned:pending.text});}
  if(event.type==='export.progress')setProgress(event.payload as ExportProgress);
  if(event.type==='models.progress'&&(event.payload as any).status==='ready')void window.dream.runtime().then(setRuntime);
 });},[]);
 const create=async(request:InitialRequest)=>{if(useEditor.getState().busy)return; s.setBusy(true);try{const project=await window.dream.createProject(request);s.setProject(project);s.setRoute('ai');await refreshProjects();return project;}catch(error){s.setError((error as Error).message);}finally{s.setBusy(false);}};
 const open=async(folder?:string)=>{const path=folder??await window.dream.pickProject();if(!path)return;if(useEditor.getState().project?.meta.folder===path){s.setRoute('ai');return;}const project=await command({type:'open',folder:path});if(project)s.setRoute('ai');};
 const importFiles=async(paths?:string[])=>{const selected=paths??await window.dream.pickMedia();if(!selected.length)return[];const before=new Set(useEditor.getState().project?.footage.assets.map(a=>a.id));const p=await command({type:'import',paths:selected,copy:true});return p?.footage.assets.filter((a:any)=>!before.has(a.id)).map((a:any)=>a.id)??[];};
 return{...s,projects,runtime,progress,setProgress,catalog,command,create,open,importFiles,refreshProjects};
}
