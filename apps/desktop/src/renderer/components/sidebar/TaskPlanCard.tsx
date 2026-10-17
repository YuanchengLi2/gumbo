import React,{useEffect,useState} from 'react';
import {Pencil,ArrowUp} from 'lucide-react';
import {TaskPlanSchema,planDocument,parsePlanDocument,type TaskPlan} from '@dream/contracts';
import {MessageText} from '../chat/MessageText';
import {ModelMenu} from '../chat/ChatComposer';
import type {ModelChoice} from '../../store/editor';
/** A proposed plan, answered as in Codex: say what to change in the bar, or accept it, choosing underneath which model
 * carries it out (the composer's model by default). */
export function TaskPlanCard({proposal,onApprove,onSave,onRevise,model,busy:working=false}:{proposal:unknown;onApprove:(plan:TaskPlan,versionId:string,revision:number,model:ModelChoice)=>Promise<any>;onSave:(document:string,revision:number,versionId:string)=>Promise<any>;onRevise:(text:string)=>Promise<boolean>;model:ModelChoice;busy?:boolean}){
 const candidate=proposal as {plan?:unknown;versionId?:string;revision?:number;turnId?:string},parsed=TaskPlanSchema.safeParse(candidate?.plan);
 const [editing,setEditing]=useState(false),[draft,setDraft]=useState(''),[pending,setBusy]=useState(false),[error,setError]=useState(''),[change,setChange]=useState(''),[runModel,setRunModel]=useState(model),busy=pending||working;
 const revision=candidate?.revision??0,key=candidate?.turnId+':'+candidate?.versionId+':'+revision;
 useEffect(()=>{setEditing(false);setError('');},[key]);
 useEffect(()=>{setRunModel(model);},[model]);
 if(!parsed.success||!candidate.versionId)return null;const plan=parsed.data;
 const save=async()=>{setError('');try{parsePlanDocument(draft,plan);setBusy(true);const result=await onSave(draft,revision,candidate.versionId!);if(result)setEditing(false);else setError('The plan could not be saved. Your draft is still here.');}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 const approve=async()=>{setBusy(true);setError('');try{if(!await onApprove(plan,candidate.versionId!,revision,runModel))setError('The plan could not be approved. Please try again.');}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 const revise=async()=>{const text=change.trim();if(!text)return;setBusy(true);setError('');try{if(await onRevise(text))setChange('');else setError('The change could not be sent. Please try again.');}catch(e){setError((e as Error).message);}finally{setBusy(false);}};
 return <section className="task-plan-card" aria-label="Proposed edit plan"><div className="plan-document-heading"><span>Proposed plan</span>{!editing&&<button className="text-button" disabled={busy} onClick={()=>{setDraft(planDocument(plan));setEditing(true);setError('');}}><Pencil size={13}/> Edit plan</button>}</div>
 {editing?<><p className="plan-editor-hint">Edit the complete plan. Keep its section headings and each step’s “Done when” section.</p><textarea className="plan-document-editor" aria-label="Edit plan document" value={draft} onChange={e=>setDraft(e.target.value)} disabled={busy}/></>:<MessageText text={planDocument(plan)}/>}
 {error&&<p className="plan-error" role="alert">{error}</p>}
 <footer>{editing?<div className="plan-editor-actions"><button className="button secondary" disabled={busy} onClick={()=>{setEditing(false);setError('');}}>Cancel</button><button className="button primary" disabled={busy} onClick={()=>void save()}>Save</button></div>:<><form className="plan-change" onSubmit={e=>{e.preventDefault();void revise();}}><input aria-label="What to change in the plan" placeholder="Tell Gumbo what to change…" value={change} disabled={busy} onChange={e=>setChange(e.target.value)}/><button type="submit" className="plan-change-send" aria-label="Send changes" disabled={busy||!change.trim()}><ArrowUp size={14}/></button></form>
  <button className="button primary plan-accept" disabled={busy} onClick={()=>void approve()}>Accept</button>
  <div className="plan-run-with"><span>Run with</span><ModelMenu value={runModel} onChange={setRunModel}/></div></>}</footer></section>;
}
