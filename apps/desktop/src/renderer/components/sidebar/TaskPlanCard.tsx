import React,{useEffect,useState} from 'react';
import {Pencil,ArrowUpRight} from 'lucide-react';
import {TaskPlanSchema,planDocument,parsePlanDocument,type TaskPlan} from '@dream/contracts';
import {MessageText} from '../chat/MessageText';
export function TaskPlanCard({proposal,onApprove,onSave}:{proposal:unknown;onApprove:(plan:TaskPlan,versionId:string,revision:number)=>Promise<any>;onSave:(document:string,revision:number,versionId:string)=>Promise<any>}){
 const candidate=proposal as {plan?:unknown;versionId?:string;revision?:number;turnId?:string},parsed=TaskPlanSchema.safeParse(candidate?.plan);
 const [editing,setEditing]=useState(false),[draft,setDraft]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
 const revision=candidate?.revision??0,key=candidate?.turnId+':'+candidate?.versionId+':'+revision;
 useEffect(()=>{setEditing(false);setError('');},[key]);
 if(!parsed.success||!candidate.versionId)return null;const plan=parsed.data;
 const save=async()=>{setError('');try{parsePlanDocument(draft,plan);setBusy(true);const result=await onSave(draft,revision,candidate.versionId!);if(result)setEditing(false);else setError('The plan could not be saved. Your draft is still here.');}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 const approve=async()=>{setBusy(true);setError('');try{if(!await onApprove(plan,candidate.versionId!,revision))setError('The plan could not be approved. Please try again.');}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 return <section className="task-plan-card" aria-label="Proposed edit plan"><div className="plan-document-heading"><span>Proposed plan</span>{!editing&&<button className="text-button" disabled={busy} onClick={()=>{setDraft(planDocument(plan));setEditing(true);setError('');}}><Pencil size={13}/> Edit plan</button>}</div>
 {editing?<><p className="plan-editor-hint">Edit the complete plan. Keep its section headings and each step’s “Done when” section.</p><textarea className="plan-document-editor" aria-label="Edit plan document" value={draft} onChange={e=>setDraft(e.target.value)} disabled={busy}/></>:<MessageText text={planDocument(plan)}/>}
 {error&&<p className="plan-error" role="alert">{error}</p>}
 <footer>{editing?<div className="plan-editor-actions"><button className="button secondary" disabled={busy} onClick={()=>{setEditing(false);setError('');}}>Cancel</button><button className="button primary" disabled={busy} onClick={()=>void save()}>Save</button></div>:<><span>You can edit this plan or ask for changes below.</span><button className="button primary" disabled={busy} onClick={()=>void approve()}>Apply edit plan <ArrowUpRight size={15}/></button></>}</footer></section>;
}
