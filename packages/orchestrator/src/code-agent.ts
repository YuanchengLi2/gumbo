import {substantiveFailure} from './intelligence';
import type {ProjectDB} from '@dream/project-db';
import type {CodeWorkspacePort,EditOutcome,TaskPlan} from '@dream/contracts';
import {models,engineBudgets} from '@dream/config';
import {codePrompt,leadPrompt} from './code-prompt';
import {toolsFor,allowedTools,parseCodeTool,validateDelegation,withinScopes,normalizeScope,type AgentRole} from './code-tools';
import {toolActivity,toolDetail} from './activity';
import {FileApprovalRequired} from './file-tools';
import {InferenceError} from './inference';
import {assertToolExchanges,repairSavedExchanges} from './tool-exchanges';
import {toolIdentity} from './tool-identity';
import {rememberDecision} from './project-memory';
import {stateChanges} from './state-delta';
import {createHash} from 'node:crypto';

export type WorkerTask={id:string;title:string;brief:string;mode?:'build'|'research';writes:string[];publish:boolean;after?:string[];context?:string[]};
/** A mode change within one turn. escalate: the engine saw this mode fail (the same error again, the step limit, repeated
 * cut-offs), so a stronger model takes over; orchestrate: the editor asked for a director; handoff: the director hands the rest back. */
export type ModeSwitch={to:'lead'|'solo';handoff:string;reason?:string;kind?:'escalate'|'orchestrate'|'handoff'};
export type Publication={versionId:string;assets:string[];processId?:string;unchanged?:boolean};
export type AgentResult={outcome:EditOutcome;plan?:TaskPlan;switch?:ModeSwitch};
export type WorkerReport={taskId:string;title:string;status:'complete'|'blocked';summary:string;nextAction?:string;publication?:Publication;changedFiles?:string[];outputs?:string[];errors?:string[];attempts?:number;durationSec?:number;costUsd?:number;skipped?:boolean};
type Checkpoint={mediaState?:string;messages:any[];pending?:any[];results:any[];completed:Record<string,any>;model:string;failures:Record<string,number>;outcome?:EditOutcome;plan?:TaskPlan;journalEpoch?:number;protocolVersion?:number;feedback?:{count:number;text:string};advice?:{key:string;question:string};consulted?:string[];resumeCount?:number;steps?:number;nudges?:number;coarse?:Record<string,number>;baseline?:string[];switch?:ModeSwitch};
const RESULT_LIMIT=24000;
// Coarse identity groups retries of the same target even when inputs differ (rewritten file content, tweaked command flags).
const coarseKey=(name:string,input:any)=>name+':'+String(input?.path??input?.output??input?.assetId??(typeof input?.command==='string'?input.command.slice(0,120):'')??'');
const modeSuffix=(role:AgentRole,planning:boolean)=>planning?'\nCurrent mode: planning. Inspect using read-only tools and return the requested plan with finish. Keep the plan as short as the request allows: one step per distinct user-visible change; a small addition is usually a single step.':role==='readonly'?'\nCurrent mode: answering. Answer this question directly; a normal final text response completes the turn.':role==='lead'||role==='worker'?'':'\nCurrent mode: execution. You are authorized to write files, install dependencies, bundle code and publish live scenes. Statements about read-only mode in earlier conversation are historical and do not restrict this request.';
// Media a tool looked at is shown in the activity stream next to the step.
const inspected=(name:string,input:any,result:any)=>{if(Array.isArray(result?.media))return{media:result.media.slice(0,24)};const id=name==='view_media'?result?.assetId??result?.evidence?.assetId??input?.assetId:undefined;return id?{media:[{id,name:String(id),kind:result?.scene?'scene':String(result?.evidence?.metadata?.kind??'video')}]}:{};};
const publicationOf=(result:any)=>result?.publication?{versionId:result.publication.versionId,assets:result.publication.assets,processId:result.publication.processId,unchanged:result.publication.unchanged}:undefined;

export async function codeAgent(options:{db:ProjectDB;workspace:CodeWorkspacePort;turnId:string;phase?:string;text:string;model:string;system?:string;role?:AgentRole;consult?:(question:string,key:string)=>Promise<string>;readOnly?:boolean;planning?:boolean;writes?:string[];canPublish?:boolean;canPropose?:boolean;research?:boolean;canSwitch?:boolean;ownsTasks?:boolean;parent?:string;bare?:boolean;taskId?:string;firstMessage?:any[];stateKnown?:boolean;runWorkers?:(tasks:WorkerTask[],callId:string)=>Promise<WorkerReport[]>;followUp?:{id:string;text:string};signal:AbortSignal;publish:(type:string,payload:any)=>void;infer:(model:string,system:string,messages:any[],tools:any[])=>Promise<any>}):Promise<AgentResult>{
 const {db,workspace,turnId,signal,publish}=options,phase=options.phase??'main',key=`code-agent:${turnId}:${phase}`;
 const planning=!!options.planning,role:AgentRole=options.role??(options.readOnly||planning?'readonly':'solo'),readOnly=role==='readonly';
 const toolOptions={canConsult:!!options.consult&&role!=='lead'&&role!=='worker',canPublish:role!=='worker'||!!options.canPublish,canPropose:!!options.canPropose,research:!!options.research,canSwitch:!!options.canSwitch},allowed=options.bare?new Set<string>():allowedTools(role,toolOptions),tools=options.bare?[]:toolsFor(role,toolOptions);
 const maxSteps=role==='lead'?engineBudgets.leadSteps:engineBudgets.agentSteps;
 await workspace.initialize();const resumed=db.loadState<Checkpoint>(key);let checkpoint=resumed??{protocolVersion:2,messages:[{role:'user',content:options.firstMessage??options.text+'\nProject context: '+JSON.stringify({projectTitle:db.meta.name,titleSource:db.getMeta('project_title_source')??'legacy',workspace:workspace.context(options.text)})}],results:[],completed:{},model:options.model,failures:{}};
 // The first message already carries the project and its media, so the state messages that follow report only changes.
 if(!resumed&&options.stateKnown!==false){const state=workspace.currentContext?.()??workspace.mediaContext?.();if(state!==undefined){const {sceneErrors:_errors,...initial}=state as any;checkpoint.mediaState=JSON.stringify({state:Array.isArray(state)?state:initial});}}
 const save=()=>db.saveState(key,checkpoint),activity=(id:string,patch:any)=>{const event=db.activityEvent(turnId,{id,...(options.parent?{parent:options.parent}:{}),...patch});if(event)publish('ai.activity',{turnId,event});};
 checkpoint.model=options.model;
 const ownsTasks=options.ownsTasks??(phase==='main'&&(role==='solo'||role==='lead'));
 const hasPendingTasks=()=>ownsTasks&&db.turnActivity(turnId)?.tasks?.some(t=>t.status!=='complete');
 const completeTasks=()=>{if(!ownsTasks)return;const tasks=db.turnActivity(turnId)?.tasks;if(tasks?.some(t=>t.status!=='complete')){const done=tasks.map(t=>({...t,status:'complete' as const}));db.setTasks(turnId,done);publish('ai.tasks',{turnId,tasks:done});}};
 // The current head must have been published (or validated unchanged) within this phase, directly or by a delegated worker.
 const headPublication=()=>{const head=db.head(),found=Object.entries(checkpoint.completed).findLast(([id,r]:any)=>r?.publication?.versionId===head&&!checkpoint.baseline?.includes(id));return found?{toolCallId:found[0]}:undefined;};
 // A publication only proves completion while nothing has changed since: later unpublished edits invalidate it.
 const unpublished=()=>workspace.unpublishedChanges?.()??[];
 const publishedHead=()=>{const found=headPublication();return found&&!unpublished().length?found:undefined;};
 const needsPublication=()=>!readOnly&&!planning&&role!=='worker';
 // The director never publishes: when nothing is waiting to be published, the engine confirms the unchanged project itself, without a model call.
 const confirmUnchanged=async(id:string)=>{if(role!=='lead'||unpublished().length)return;const confirmId=id+':confirm';const result=await workspace.execute('publish_project',{},confirmId,turnId,signal);if(result?.publication?.versionId!==db.head())return;checkpoint.completed[confirmId]={saved:true,publication:publicationOf(result)};save();return{toolCallId:confirmId};};
 // What a stronger model needs when the engine moves a failing request up: the request, the latest notes and what is published.
 const engineHandoff=(why:string)=>`The editor working alone ${why}. Request: ${options.text.slice(0,4000)}
Its latest notes: ${checkpoint.messages.filter(m=>m.role==='assistant'&&Array.isArray(m.content)).flatMap(m=>m.content.filter((b:any)=>b.type==='text').map((b:any)=>String(b.text))).slice(-3).join(' | ').slice(0,3000)||'none'}
Files written so far are still in the workspace; ${headPublication()?'the latest publication is live':'nothing from this request is published yet'}.`;
 const escalate=(reason:string,why:string)=>{if(!options.canSwitch||role!=='solo'||checkpoint.switch)return false;checkpoint.switch={to:'lead',kind:'escalate',reason,handoff:engineHandoff(why)};save();return true;};
 const switched=()=>({outcome:{status:'blocked' as const,summary:checkpoint.switch!.reason??'Continuing in the other mode.',evidence:[],nextAction:'Continue in the next mode.'},switch:checkpoint.switch});
 const closeBatch=()=>{if(!checkpoint.pending)return;for(const call of checkpoint.pending)if(!checkpoint.results.some(r=>r.tool_use_id===call.id))checkpoint.results.push({type:'tool_result',tool_use_id:call.id,is_error:true,content:JSON.stringify({skipped:true,reason:'This call was not executed because the request ended or received new instructions.'})});checkpoint.messages.push({role:'user',content:checkpoint.results});delete checkpoint.pending;checkpoint.results=[];};
 const conclude=(outcome:EditOutcome)=>{checkpoint.outcome=outcome;if(outcome.status==='complete'&&needsPublication())completeTasks();};
 if(checkpoint.protocolVersion!==2){
  checkpoint.messages=repairSavedExchanges(checkpoint.messages,id=>db.loadState(key+':call:'+id),!!checkpoint.pending);
  const lastAssistant=checkpoint.messages.findLastIndex(m=>m.role==='assistant'),following=checkpoint.messages[lastAssistant+1];if(checkpoint.pending&&following?.role==='user'&&Array.isArray(following.content)&&checkpoint.pending.every(call=>following.content.some((r:any)=>r.type==='tool_result'&&r.tool_use_id===call.id))){delete checkpoint.pending;checkpoint.results=[];}
  checkpoint.journalEpoch=(checkpoint.journalEpoch??0)+1;checkpoint.protocolVersion=2;
  if(checkpoint.outcome)closeBatch();save();
 }
 const resumeCount=Number(db.getMeta('resume_count:'+turnId)??0);if(checkpoint.outcome?.status==='blocked'&&resumeCount>(checkpoint.resumeCount??0)){closeBatch();delete checkpoint.outcome;checkpoint.steps=0;checkpoint.nudges=0;checkpoint.messages.push({role:'user',dreamSource:'nudge',content:'Resume the interrupted request. Recheck the blocker against the current saved project and continue if it is resolved.'});}checkpoint.resumeCount=resumeCount;
 // User feedback belongs to the conversation the user sees: the lead/solo phase, never a worker or a consultation.
 const feedback=role!=='worker'&&!phase.startsWith('direction-')?db.loadState<any>('resume_input:'+turnId):undefined;if(feedback&&!db.getMeta(key+':feedback:'+feedback.count)){checkpoint.feedback=feedback;delete checkpoint.outcome;}
 if(checkpoint.feedback&&checkpoint.pending){closeBatch();save();}
 // The next approved plan step continues the same conversation. Earlier steps' publications cannot complete it.
 if(options.followUp&&!db.getMeta(key+':followup:'+options.followUp.id)){db.db.transaction(()=>{if(resumed){if(checkpoint.pending)closeBatch();checkpoint.baseline=Object.keys(checkpoint.completed);delete checkpoint.outcome;delete checkpoint.plan;checkpoint.steps=0;checkpoint.nudges=0;checkpoint.messages.push({role:'user',content:options.followUp!.text});}db.setMeta(key+':followup:'+options.followUp!.id,'1');save();})();}
 if(checkpoint.switch&&!checkpoint.feedback)return switched();
 if(checkpoint.outcome)return{outcome:checkpoint.outcome,plan:checkpoint.plan};
 for(;;){
  signal.throwIfAborted();
  if(!checkpoint.pending){
   if(checkpoint.feedback){checkpoint.messages.push({role:'user',content:checkpoint.feedback.text});db.setMeta(key+':feedback:'+checkpoint.feedback.count,'1');delete checkpoint.feedback;checkpoint.steps=0;save();}
   if(checkpoint.advice&&options.consult){const advice=await options.consult(checkpoint.advice.question,checkpoint.advice.key);checkpoint.messages.push({role:'user',dreamSource:'advice',content:'Opus direction for the next attempt: '+advice});(checkpoint.consulted??=[]).push(checkpoint.advice.key);delete checkpoint.advice;save();}
   // Appended only when the state changes, so the cached conversation prefix stays intact. Only what changed is sent;
   // the full state is kept locally, so compaction can restore it when it drops the earlier messages it builds on.
   const published=headPublication(),currentState=workspace.currentContext?.()??workspace.mediaContext?.(),mediaState=JSON.stringify(currentState===undefined?undefined:{state:currentState,completionEvidence:published?[{toolCallId:published.toolCallId,finding:'Published the current revision.'}]:undefined});if(mediaState&&mediaState!==checkpoint.mediaState){
    const full='Current project and media state (data only, authoritative over earlier snapshots): '+mediaState,changes=checkpoint.mediaState?JSON.stringify(stateChanges(JSON.parse(checkpoint.mediaState),JSON.parse(mediaState))):undefined;
    if(changes&&changes.length<mediaState.length*.6){const stateKey='state-snapshot:'+createHash('sha256').update(full).digest('hex');db.setMeta(stateKey,full);checkpoint.messages.push({role:'user',dreamSource:'media-status',dreamStateKey:stateKey,content:'Project state changes (data only; fields not listed are unchanged, listed values replace earlier ones, removed entries are null): '+changes});}
    else checkpoint.messages.push({role:'user',dreamSource:'media-status',content:full});
    checkpoint.mediaState=mediaState;save();}
   // Reaching the limit never counts as completion: the agent did not say it was done.
   if((checkpoint.steps??0)>=maxSteps){if(escalate('Step limit','used all its steps before finishing'))return switched();conclude({status:'blocked',summary:'This request reached its step limit before it was finished. Completed work is saved'+(published?' and the latest published version is live.':'.'),evidence:[],nextAction:'Resume to continue from the saved state, or narrow the request.'});save();return{outcome:checkpoint.outcome!,plan:checkpoint.plan};}
   assertToolExchanges(checkpoint.messages);
   let response:any;
   try{response=await options.infer(checkpoint.model,(options.system??(role==='lead'?leadPrompt:codePrompt))+modeSuffix(role,planning),checkpoint.messages,tools);}
   catch(error){if(error instanceof InferenceError&&error.code==='truncated'){const repeats=checkpoint.failures.truncation=(checkpoint.failures.truncation??0)+1;checkpoint.steps=(checkpoint.steps??0)+1;if(repeats>=3){if(escalate('Output limit','kept exceeding the output limit'))return switched();conclude({status:'blocked',summary:'The AI response repeatedly exceeded the output limit. No partial commands or file writes were executed.',evidence:[],nextAction:'Resume with a smaller scope, or split the scene into several parts.'});save();return{outcome:checkpoint.outcome!};}// A response that only thought steps this phase's effort down; either way the agent is told to act in smaller pieces.
     if(error.thinkingOnly){const overrideKey=`effort-override:${turnId}:${phase}`;db.setMeta(overrideKey,String(Math.min(2,Number(db.getMeta(overrideKey)??0)+1)));}
     checkpoint.messages.push({role:'user',dreamSource:'nudge',content:error.thinkingOnly?'The last response spent its whole allowance thinking and produced nothing. Act now: make one concrete tool call for the first piece (for example, write the first small file), then continue step by step.':'The last response was cut off at the output limit and none of its tool calls ran. Split the work: write large content as several smaller files or focused edit_file patches, and keep each response to a few compact tool calls.'});save();continue;}throw error;}
   delete checkpoint.failures.truncation;checkpoint.steps=(checkpoint.steps??0)+1;
   checkpoint.messages.push({role:'assistant',content:response.content});checkpoint.pending=response.content.filter((b:any)=>b.type==='tool_use');checkpoint.results=[];save();
   if(['refusal','model_context_window_exceeded'].includes(response.stop_reason)){conclude({status:'blocked',summary:response.content.filter((b:any)=>b.type==='text').map((b:any)=>b.text).join('\n')||'The provider could not complete this request.',evidence:[],nextAction:response.stop_reason==='refusal'?'Revise the request before continuing.':'Continue with a smaller, focused scope.'});closeBatch();save();return{outcome:checkpoint.outcome!};}
   if(!checkpoint.pending!.length){
    const answer=response.content.filter((b:any)=>b.type==='text').map((b:any)=>b.text).join('\n\n').trim(),nudges=checkpoint.nudges??0;delete checkpoint.pending;
    const current=publishedHead()??(answer&&response.stop_reason==='end_turn'&&!hasPendingTasks()?await confirmUnchanged('text:'+(checkpoint.steps??0)):undefined);
    if(!planning&&answer&&response.stop_reason==='end_turn'&&(readOnly||role==='worker'||current&&!hasPendingTasks())){conclude({status:'complete',summary:answer,evidence:readOnly||role==='worker'||!current?[]:[{toolCallId:current.toolCallId,finding:'Published the current revision.'}]});save();return{outcome:checkpoint.outcome!};}
    if(nudges>=engineBudgets.textNudges){
     // Stop nudging: accept a published edit, otherwise report honestly instead of looping.
     conclude(!planning&&current&&needsPublication()?{status:'complete',summary:answer||'The edit is published to the live preview.',evidence:[{toolCallId:current.toolCallId,finding:'Published the current revision.'}]}:{status:'blocked',summary:answer||'The request stopped before a change was published.',evidence:[],nextAction:planning?'Resume to return the plan.':'Resume to continue the edit.'});save();return{outcome:checkpoint.outcome!,plan:checkpoint.plan};
    }
    checkpoint.nudges=nudges+1;
    checkpoint.messages.push({role:'user',dreamSource:'nudge',content:planning?'Return the editable plan with finish.':role==='lead'?'Continue directing: dispatch workers for what remains, or call finish (complete once the work is published, or blocked with a concrete reason).':'Continue the requested work using the available capabilities, or call finish (complete once published, or blocked with a concrete reason).'});save();continue;
   }
   checkpoint.nudges=0;
  }
  for(let n=checkpoint.results.length;n<checkpoint.pending!.length;n++){
   signal.throwIfAborted();const call=checkpoint.pending![n],receiptKey=key+':call:'+call.id,operationKey=toolIdentity(call.name,call.input),identityKey=receiptKey+':identity',coarse=coarseKey(call.name,call.input);const priorIdentity=db.getMeta(identityKey);if(priorIdentity&&priorIdentity!==operationKey)throw new Error('A tool request ID was reused for different instructions. No additional change was executed.');if(!priorIdentity)db.setMeta(identityKey,operationKey);let result=db.loadState<any>(receiptKey);
   if(!result){
    activity('tool:'+call.id,{kind:'action',tool:call.name,text:toolActivity(call.name,call.input)??call.name,status:'running',detail:toolDetail(call.name,call.input)});
    try{
     const input:any=parseCodeTool(call.name,call.input,readOnly,allowed);
     if(role==='worker'){
      if(['write_file','edit_file'].includes(call.name)){const target=normalizeScope(input.path);if(target==='project.json'&&!options.canPublish)throw new Error('This task does not own project.json; the lead integrates the timeline. Write your files and finish.');if(options.writes?.length&&target!=='project.json'&&!withinScopes(target,options.writes))throw new Error(`This task may only write under ${options.writes.join(', ')}.`);}
      if(call.name==='bundle_scene'&&options.writes?.length&&!withinScopes(input.output,options.writes)&&!normalizeScope(input.output).startsWith(`output/${options.taskId}`))throw new Error(`Bundle into output/${options.taskId}-... or a declared write path.`);
     }
     if(call.name==='finish'){
      if(input.status==='blocked'&&!input.nextAction)throw new Error('A blocker needs the concrete nextAction.');
      if(planning&&input.status==='complete'&&!input.plan)throw new Error('Return the requested editable plan with finish.');
      let evidence=input.evidence.filter((e:any)=>checkpoint.completed[e.toolCallId]);
      if(input.status==='complete'&&needsPublication()){
       const current=publishedHead()??await confirmUnchanged(call.id),pending=current?[]:unpublished();
       if(!current&&role==='lead')throw new Error(`Workers left changes that are not published (${pending.slice(0,8).join(', ')}). Delegate an integration task with publish:true before finishing.`);
       if(!current&&pending.length&&headPublication())throw new Error(`There are unpublished changes since the last publication (${pending.slice(0,8).join(', ')}). Publish them, or restore them, before finishing.`);
       if(!current)throw new Error('Publish the current revision with publish_project before finishing; an unchanged project returns a no-change receipt.');
       if(!evidence.some((e:any)=>e.toolCallId===current.toolCallId))evidence=[...evidence,{toolCallId:current.toolCallId,finding:'Published the current revision to the live preview.'}];
      }
      // Scenes changed in this request that failed while playing must be fixed first (errors come from the visible player and chat previews).
      const broken=input.status==='complete'&&!planning&&!options.research?workspace.sceneErrors?.(turnId)??[]:[];
      if(broken.length)throw new Error(`These scenes reported errors while playing: ${broken.slice(0,5).map(e=>`${e.scene}${e.location?` (${e.location})`:''}: ${e.message}`).join('; ')}. Fix them${role==='lead'?' through a build worker':''} and publish again before finishing.`);
      conclude(input.status==='complete'?{status:'complete',summary:input.summary,evidence}:{status:'blocked',summary:input.summary,evidence,nextAction:input.nextAction});checkpoint.plan=planning?input.plan:undefined;result={finished:true};
     }else if(call.name==='delegate'){
      if(!options.runWorkers)throw new Error('Delegation is unavailable in this phase.');
      validateDelegation(input.tasks);
      const reports=await options.runWorkers(input.tasks,call.id);
      result={reports,publication:[...reports].reverse().find(r=>r.publication)?.publication};
     }else if(call.name==='switch_to_orchestrated'||call.name==='hand_off'){
      checkpoint.switch=call.name==='hand_off'?{to:'solo',kind:'handoff',handoff:input.brief}:{to:'lead',kind:'orchestrate',handoff:input.handoff,reason:input.reason};result={switching:true};
     }else if(call.name==='remember_decision'){result={memory:rememberDecision(db,input),saved:true};}else if(call.name==='consult_director'){if(!options.consult)throw new Error('Director consultation is unavailable within director mode.');result={guidance:await options.consult(input.question,call.id)};}else if(call.name==='set_project_title'){if(db.getMeta('project_title_source')!=='user'){db.rename(input.title);db.setMeta('project_title_source','ai');publish('state',db.state({bounded:true}));}result={title:db.meta.name,saved:true};}else if(call.name==='update_tasks'){db.setTasks(turnId,input.tasks);if(input.notes)db.setMeta(`task-notes:${turnId}:${phase}`,input.notes);publish('ai.tasks',{turnId,tasks:input.tasks});result={saved:true};}
     else result=await workspace.execute(call.name,input,call.id,turnId,signal,role==='worker'?{writes:options.writes??[],canPublish:!!options.canPublish,taskId:options.taskId,parent:options.parent}:undefined);
     if(result?.process&&result.process.status!=='complete')throw new Error(`Command ${result.process.status}: ${result.process.output}. Log: ${result.process.id}`);
     delete checkpoint.failures[operationKey];if(checkpoint.coarse)delete checkpoint.coarse[coarse];db.saveState(receiptKey,result);checkpoint.completed[call.id]={saved:true,publication:publicationOf(result),evidence:result?.evidence};activity('tool:'+call.id,{kind:'action',tool:call.name,text:toolActivity(call.name,input)??call.name,status:'complete',...inspected(call.name,input,result)});
    }catch(error){
     // Spending limits and account problems end the request; they are not tool errors to retry.
     if(signal.aborted||error instanceof FileApprovalRequired||error instanceof InferenceError&&['quota','authentication','request_budget'].includes(error.code))throw error;
     const message=(error as Error).message,count=(checkpoint.failures[operationKey]??0)+1,similar=((checkpoint.coarse??={})[coarse]??0)+1;checkpoint.failures[operationKey]=count;checkpoint.coarse[coarse]=similar;
     result={error:message,diagnosisRequired:count>=2||similar>=3};db.saveState(receiptKey,result);activity('tool:'+call.id,{kind:'action',tool:call.name,text:toolActivity(call.name,call.input)??call.name,status:'failed',detail:message});
     if((count===2||similar===3)&&options.canSwitch&&role==='solo'&&substantiveFailure(error)&&!checkpoint.outcome){checkpoint.switch={to:'lead',kind:'escalate',reason:'Repeated failure',handoff:`The editor working alone kept failing at the same step. Request: ${options.text.slice(0,4000)}\nLast step: ${call.name} ${JSON.stringify(call.input).slice(0,3000)}\nError: ${message.slice(0,2000)}\nFiles written so far are still in the workspace; nothing after the last publication is published.`};db.event('ai.director_requested',{turnId,reason:message,model:models.lead});}
     else if((count===2||similar===3)&&options.consult&&role==='solo'&&substantiveFailure(error)){const adviceKey=operationKey+':'+call.id;if(!checkpoint.consulted?.includes(adviceKey)){checkpoint.advice={key:adviceKey,question:`Diagnose this repeated failure and direct a revised approach. Request: ${options.text}\nTool: ${call.name}\nInput: ${JSON.stringify(call.input).slice(0,6000)}\nError: ${message}`};db.event('ai.director_requested',{turnId,reason:message,model:models.director});}}
     // The same error three times (or a similar one four times) ends the request instead of spending more steps on it.
     if(count>=3||similar>=4)conclude({status:'blocked',summary:'Repeated attempts could not complete this step: '+message,evidence:[],nextAction:'Resolve the diagnosed failure, then resume with the saved source and logs.'});
    }
   }else if(!result.error){checkpoint.completed[call.id]={saved:true,publication:publicationOf(result),evidence:result?.evidence};if(call.name==='finish'&&result.finished&&!checkpoint.outcome){const input:any=parseCodeTool('finish',call.input,readOnly,allowed);conclude(input.status==='complete'?{status:'complete',summary:input.summary,evidence:input.evidence}:{status:'blocked',summary:input.summary,evidence:input.evidence,nextAction:input.nextAction});checkpoint.plan=planning?input.plan:undefined;}}
   db.setMeta('workspace-receipt-summary:'+receiptKey,JSON.stringify({receipt:receiptKey,tool:call.name,path:call.input?.path,command:call.input?.command,status:result?.error?'failed':'complete',error:result?.error,publication:result?.publication?{versionId:result.publication.versionId,changes:result.publication.changes}:undefined,process:result?.process?{id:result.process.id,status:result.process.status,output:String(result.process.output??'').slice(-2000)}:undefined}));db.db.prepare('INSERT OR IGNORE INTO context_dirty VALUES(?,?)').run('execution',receiptKey);
   const content=result?.content??JSON.stringify(result);checkpoint.results.push({type:'tool_result',tool_use_id:call.id,is_error:!!result?.error,content:typeof content==='string'&&content.length>RESULT_LIMIT?JSON.stringify({excerpt:content.slice(0,RESULT_LIMIT-2000),receipt:receiptKey,instruction:'Use search or read_file with scope receipt for relevant details; full result is archived.'}):content});save();
   if(checkpoint.switch){closeBatch();save();return switched();}
   const outcome=checkpoint.outcome as EditOutcome|undefined;
   if(outcome){closeBatch();save();if(checkpoint.feedback){delete checkpoint.outcome;save();break;}if(role!=='worker')activity('finish:'+turnId+':'+phase,{kind:'terminal',text:outcome.summary,status:outcome.status});return{outcome,plan:checkpoint.plan};}
  }
  closeBatch();
  save();
 }
}
