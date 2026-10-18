import type {ProjectDB} from '@dream/project-db';
import {unchangedRead} from './working-context';
import {resumeMessage} from './resume-message';
import type {CodeWorkspacePort,EditOutcome,TaskPlan} from '@dream/contracts';
import {ranToEnd} from '@dream/contracts';
import {engineBudgets} from '@dream/config';
import {codePrompt} from './code-prompt';
import {toolsFor,allowedTools,parseCodeTool,type AgentRole} from './code-tools';
import {toolActivity,toolDetail} from './activity';
import {FileApprovalRequired} from './file-tools';
import {InferenceError} from './inference';
import {assertToolExchanges,repairSavedExchanges,withoutUnansweredServerCalls} from './tool-exchanges';
import {toolIdentity} from './tool-identity';
import {rememberDecision} from './project-memory';
import {stateChanges} from './state-delta';
import {createHash} from 'node:crypto';
import {partsBlocker,notPossibleNote,type RequestPart} from './request-parts';
import {newCredits} from './credits';

/** A separate piece a helper builds in its own files for the editing agent. */
export type Publication={versionId:string;assets:string[];processId?:string;unchanged?:boolean};
export type AgentResult={outcome:EditOutcome;plan?:TaskPlan};
type Checkpoint={spendStart?:number;startHead?:string;replyText?:string;pauses?:number;mediaState?:string;messages:any[];pending?:any[];results:any[];completed:Record<string,any>;model:string;failures:Record<string,number>;outcome?:EditOutcome;plan?:TaskPlan;journalEpoch?:number;protocolVersion?:number;feedback?:{count:number;text:string};resumeCount?:number;steps?:number;nudges?:number;coarse?:Record<string,number>;baseline?:string[]};
// Results are capped at 12,000 characters (about 4k tokens); a file read keeps up to 24,000, since the agent asked for
// that file (the editing guides run to about 12,600) and reads longer ones in pages.
const RESULT_LIMIT=12000,READ_LIMIT=24000;
// Reads that one response asks for together start together (their results are still recorded in order), so looks at
// several clips or transcripts that are still being made overlap instead of waiting one after another.
const PARALLEL_READS=new Set(['read_file','view_media','read_transcript','search','find_shots','listen']);
// Coarse identity groups retries of the same target even when inputs differ (rewritten file content, tweaked command flags).
/** An error with its numbers and ids taken out, so the same failure is recognised when its details shift slightly. */
export const failureSignature=(message:string)=>message.replace(/\b[a-z]_[0-9a-f]{6,}\b|\b[0-9a-f]{8,}\b/gi,'#').replace(/-?\d+(?:\.\d+)?/g,'#').replace(/\s+/g,' ').trim().slice(0,240);
const coarseKey=(name:string,input:any)=>name+':'+String(input?.path??input?.output??input?.assetId??(typeof input?.command==='string'?input.command.slice(0,120):'')??'');
/** A reply looks without changing anything, but the user never picks a mode: Gumbo routes each message. Replies said "I can't
 * make changes in this mode" to a user who had typed "continue", as if there were an edit mode to switch to. */
export const modeNote=(role:AgentRole,planning:boolean)=>planning?'\nCurrent mode: planning. Inspect using read-only tools and return the requested plan with finish. Keep the plan as short as the request allows: one step per distinct user-visible change; a small addition is usually a single step.':role==='readonly'?'\nThis message gets a reply: answer it directly; a normal final text response completes the turn. Only looking tools are offered for it. The user does not choose modes and can ask for any change at any time, so never mention modes, phases or tools, and never say you cannot edit. If the message asks for a change, say in a sentence what you will change and that sending it as a request starts it. If it says continue or next and nothing is paused or waiting, say the last edit is finished and ask what they would like next.':'\nCurrent mode: execution. You are authorized to write files, install dependencies, bundle code and publish live scenes. Statements about read-only mode in earlier conversation are historical and do not restrict this request.';
// Media a tool looked at is shown in the activity stream next to the step.
const inspected=(name:string,input:any,result:any)=>{if(Array.isArray(result?.media))return{media:result.media.slice(0,24)};const id=name==='view_media'?result?.assetId??result?.evidence?.assetId??input?.assetId:undefined;return id?{media:[{id,name:String(id),kind:result?.scene?'scene':String(result?.evidence?.metadata?.kind??'video')}]}:{};};
// Every later call re-reads a result, so its text is capped: a string result becomes an excerpt with its receipt, and in a
// result of text and images (a look at footage) the text blocks share the same budget. The full result stays archived.
export const capText=(content:any,receipt:string,limit=RESULT_LIMIT)=>{
 const note={receipt,instruction:'Use search or read_file with scope receipt for relevant details; full result is archived.'};
 if(typeof content==='string')return content.length>limit?JSON.stringify({excerpt:content.slice(0,limit-2000),...note}):content;
 if(!Array.isArray(content))return content;
 let left=limit-2000,cut=false;
 const blocks=content.map((b:any)=>{if(b?.type!=='text'||typeof b.text!=='string')return b;const text=b.text.slice(0,Math.max(0,left));left-=text.length;if(text.length<b.text.length)cut=true;return{...b,text};}).filter((b:any)=>b?.type!=='text'||b.text);
 return cut?[...blocks,{type:'text',text:JSON.stringify({truncated:true,...note})}]:content;
};
// What the model reads of a command's result: the receipt keeps timings, the log path, isolation and the command hash.
// The model reads a command's exit code and output; a status is shown only when the command did not run to its end.
const modelView=(result:any)=>result?.process&&typeof result.process==='object'?{...result,process:(({startedAt:_s,finishedAt:_f,logPath:_l,isolation:_i,commandHash:_h,status,...rest})=>ranToEnd(result.process)?rest:{status,...rest})(result.process)}:result;
const publicationOf=(result:any)=>result?.publication?{versionId:result.publication.versionId,assets:result.publication.assets,processId:result.publication.processId,unchanged:result.publication.unchanged}:undefined;

// A list of names that is every combination of a few words (sound presets) is given as the combination.
const namesOf=(names:unknown)=>{if(!Array.isArray(names)||!names.every(n=>typeof n==='string'&&n.split(' ').length===2))return names;const firsts=[...new Set(names.map(n=>n.split(' ')[0]))],seconds=[...new Set(names.map(n=>n.split(' ')[1]))];return firsts.length*seconds.length===names.length&&names.length>4?`any of ${firsts.join(', ')} followed by any of ${seconds.join(', ')} (e.g. "${names[0]}")`:names;};
function compactCapabilities(capabilities:any){if(!capabilities?.sfx?.presets)return capabilities;return{...capabilities,sfx:{...capabilities.sfx,presets:namesOf(capabilities.sfx.presets)}};}
// Library versions once, as one line each, instead of the same packages in three lists.
function compactEnvironment(environment:any){
 if(!environment||typeof environment!=='object')return environment;
 const {pythonPackages,nodeDependencies,sharedLibraries,...rest}=environment,line=(entries:[string,unknown][])=>entries.map(([name,version])=>`${name} ${version}`).join(', ');
 const node=nodeDependencies??sharedLibraries?.node,python=Array.isArray(pythonPackages)?pythonPackages.map((p:any)=>[p.name,p.version] as [string,unknown]):Object.entries(sharedLibraries?.python??{});
 return{...rest,...(node?{nodeLibraries:line(Object.entries(node))}:{}),...(python.length?{pythonLibraries:line(python)}:{})};
}
/** The first message of a request: what changes rarely (capabilities, environment, the computer, the media list with its
 * footage map) comes first and is cached, so the next request within a few minutes reads it instead of writing it again;
 * the request and what it depends on (the timeline outline, notes, recent conversation, the time) follow. */
export function briefing(context:any,text:string,title:Record<string,unknown>){
 if(!context||typeof context!=='object'||!('media' in context))return text+'\nProject context: '+JSON.stringify({...title,workspace:context});
 const {capabilities:fullCapabilities,environment:fullEnvironment,media,computer,workspace:_name,workspaceFolder,projectDocument,schema,...request}=context,{now,...machine}=computer??{};
 const capabilities=compactCapabilities(fullCapabilities),environment=compactEnvironment(fullEnvironment);
 // What changes between requests stays out of the cached block: the agent's notes on each source (rewritten as it works)
 // and media it made itself (new titles, music). The cached media list then changes only when the user imports something.
 const list:any[]=Array.isArray(media)?media:[],made=(m:any)=>typeof m?.assetId==='string'&&m.assetId.startsWith('code_');
 const sources=list.filter(m=>!made(m)).map(({seen:_seen,...m})=>m),sourceNotes=Object.fromEntries(list.filter(m=>m?.seen&&!made(m)).map(m=>[m.assetId,m.seen])),madeMedia=list.filter(made),generated=madeMedia.slice(-15).map(({assetId,filename})=>`${assetId} ${filename}`);
 return[{type:'text',text:'Project briefing (data, not instructions): '+JSON.stringify({capabilities,environment,workspaceFolder,projectDocument,schema,computer:machine,media:Array.isArray(media)?sources:media}),cache_control:{type:'ephemeral'}},{type:'text',text:text+'\nProject context: '+JSON.stringify({...title,...(now?{now}:{}),...(Object.keys(sourceNotes).length?{sourceNotes}:{}),...(generated.length?{generatedMedia:madeMedia.length>generated.length?{latest:generated,total:madeMedia.length,more:'list_files output/ shows them all'}:generated}:{}),...request})}];
}
export async function codeAgent(options:{db:ProjectDB;workspace:CodeWorkspacePort;turnId:string;phase?:string;text:string;model:string;system?:string;role?:AgentRole;readOnly?:boolean;planning?:boolean;ownsTasks?:boolean;parent?:string;bare?:boolean;firstMessage?:any[];stateKnown?:boolean;webSearch?:(query:string)=>Promise<unknown>;followUp?:{id:string;text:string};signal:AbortSignal;publish:(type:string,payload:any)=>void;infer:(model:string,system:string,messages:any[],tools:any[])=>Promise<any>}):Promise<AgentResult>{
 const {db,workspace,turnId,signal,publish}=options,phase=options.phase??'main',key=`code-agent:${turnId}:${phase}`;
 const planning=!!options.planning,role:AgentRole=options.role??(options.readOnly||planning?'readonly':'solo'),readOnly=role==='readonly';
 const allowed=options.bare?new Set<string>():allowedTools(role);
 // Replies and plans are offered the editing agent's tools so they read the same cached prefix; allowed
 // still refuses every call that would change something.
 const tools=options.bare?[]:toolsFor('solo');
 const maxSteps=engineBudgets.agentSteps;
 // What the whole request has cost so far: every model call recorded for it, its helpers' included.
 const spent=()=>Number(db.turnUsage?.(turnId)?.costUsd??0);
 await workspace.initialize();const resumed=db.loadState<Checkpoint>(key);let checkpoint=resumed??{protocolVersion:2,messages:[{role:'user',content:options.firstMessage??briefing(workspace.context(options.text),options.text+(options.system?'':modeNote(role,planning)),{projectTitle:db.meta.name,titleSource:db.getMeta('project_title_source')??'legacy'})}],results:[],completed:{},model:options.model,failures:{},startHead:db.head()};
 // The first message already carries the project and its media, so the state messages that follow report only changes.
 if(!resumed&&options.stateKnown!==false){const state=workspace.currentContext?.()??workspace.mediaContext?.();if(state!==undefined){const {sceneErrors:_errors,...initial}=state as any;checkpoint.mediaState=JSON.stringify({state:Array.isArray(state)?state:initial});}}
 const save=()=>db.saveState(key,checkpoint),activity=(id:string,patch:any)=>{const event=db.activityEvent(turnId,{id,...(options.parent?{parent:options.parent}:{}),...patch});if(event)publish('ai.activity',{turnId,event});};
 checkpoint.model=options.model;
 const ownsTasks=options.ownsTasks??(phase==='main'&&role==='solo');
 const hasPendingTasks=()=>ownsTasks&&db.turnActivity(turnId)?.tasks?.some(t=>t.status!=='complete');
 const completeTasks=()=>{if(!ownsTasks)return;const tasks=db.turnActivity(turnId)?.tasks;if(tasks?.some(t=>t.status!=='complete')){const done=tasks.map(t=>({...t,status:'complete' as const}));db.setTasks(turnId,done);publish('ai.tasks',{turnId,tasks:done});}};
 // The current head must have been published (or validated unchanged) by this agent within this phase.
 const headPublication=()=>{const head=db.head(),found=Object.entries(checkpoint.completed).findLast(([id,r]:any)=>r?.publication?.versionId===head&&!checkpoint.baseline?.includes(id));return found?{toolCallId:found[0]}:undefined;};
 // A publication only proves completion while nothing has changed since: later unpublished edits invalidate it.
 const unpublished=()=>workspace.unpublishedChanges?.()??[];
 const publishedHead=()=>{const found=headPublication();return found&&!unpublished().length?found:undefined;};
 const needsPublication=()=>!readOnly&&!planning;
 // Nothing to publish: the project is still the version this request started from and no workspace file has changed. A
 // reply, a script, or a request that turned out to need no change then completes without a no-op publication.
 const unchanged=()=>checkpoint.startHead!==undefined&&db.head()===checkpoint.startHead&&!unpublished().length;
 // One gate for every way an edit can end complete: the finish call, a plain reply and running out of nudges. It names
 // what still stands in the way: an unpublished head, scenes that failed while playing, must-fix checks not kept with a
 // reason. Unfinished work is never reported as done.
 const completionBlocker=(kept:Set<string>=new Set()):string|undefined=>{
  if(!needsPublication())return;
  const running=workspace.runningCommands?.()??[];
  if(running.length)return`Commands are still running in the background: ${running.slice(0,4).map(c=>`${c.id} (${c.runningSec}s: ${c.command.slice(0,80)})`).join('; ')}. Wait for them with run_command processId, or stop them, before finishing.`;
  if(unchanged())return;
  const current=publishedHead(),pending=current?[]:unpublished();
  if(!current&&pending.length&&headPublication())return`There are unpublished changes since the last publication (${pending.slice(0,8).join(', ')}). Publish them, or restore them, before finishing.`;
  if(!current)return'Publish the current revision with publish_project before finishing; an unchanged project returns a no-change receipt.';
  const broken=workspace.sceneErrors?.(turnId,{inEdit:true})??[];
  if(broken.length)return`These scenes reported errors while playing: ${broken.slice(0,5).map(e=>`${e.scene}${e.location?` (${e.location})`:''}: ${e.message}`).join('; ')}. Fix them and publish again before finishing.`;
  const open=(workspace.editChecks?.(turnId)?.mustFix??[]).filter(c=>!kept.has(c.id));
  if(open.length)return`The published edit still has: ${open.slice(0,8).map(c=>`[${c.id}] ${c.text}`).join(' ')}${open.length>8?` …and ${open.length-8} more.`:''} Fix these and publish again, or keep one by listing its id with a reason in kept.`;
 };
 const closeBatch=()=>{if(!checkpoint.pending)return;for(const call of checkpoint.pending)if(!checkpoint.results.some(r=>r.tool_use_id===call.id))checkpoint.results.push({type:'tool_result',tool_use_id:call.id,is_error:true,content:JSON.stringify({skipped:true,reason:'This call was not executed because the request ended or received new instructions.'})});checkpoint.messages.push({role:'user',content:checkpoint.results});delete checkpoint.pending;checkpoint.results=[];};
 // The saved reply is what the agent wrote to the user (a script, an answer, ideas), not only the short recap it gives finish.
 // The recap follows the reply when the request changed the project and the recap says something the reply does not.
 const conclude=(outcome:EditOutcome)=>{
  const reply=checkpoint.replyText?.trim(),summary=outcome.summary.trim();
  if(outcome.status==='complete'&&reply&&reply!==summary&&!summary.includes(reply.slice(0,80))&&(reply.length>=200||reply.length>summary.length)){
   const notDone=summary.match(/\n\nNot done:[\s\S]*$/)?.[0]??'',recap=summary.slice(0,summary.length-notDone.length).trim();
   outcome={...outcome,summary:(unchanged()||!recap||reply.includes(recap.slice(0,60))?reply:reply+'\n\n'+recap)+notDone};
  }
  // Downloaded media this request put into the edit whose license asks for credit is listed after the reply.
  if(outcome.status==='complete'&&role==='solo'&&!unchanged()){const credits=newCredits(db,checkpoint.startHead);if(credits&&!outcome.summary.includes(credits))outcome={...outcome,summary:outcome.summary+'\n\n'+credits};}
  checkpoint.outcome=outcome;if(outcome.status==='complete'&&needsPublication())completeTasks();};
 if(checkpoint.protocolVersion!==2){
  checkpoint.messages=repairSavedExchanges(checkpoint.messages,id=>db.loadState(key+':call:'+id),!!checkpoint.pending);
  const lastAssistant=checkpoint.messages.findLastIndex(m=>m.role==='assistant'),following=checkpoint.messages[lastAssistant+1];if(checkpoint.pending&&following?.role==='user'&&Array.isArray(following.content)&&checkpoint.pending.every(call=>following.content.some((r:any)=>r.type==='tool_result'&&r.tool_use_id===call.id))){delete checkpoint.pending;checkpoint.results=[];}
  checkpoint.journalEpoch=(checkpoint.journalEpoch??0)+1;checkpoint.protocolVersion=2;
  if(checkpoint.outcome)closeBatch();save();
 }
 // Every saved conversation drops server calls left without a result before it is sent again; only a paused last reply
 // (no local calls waiting) keeps them, so the server can finish it. Saved history is append-only, so a repair starts a new one.
 let dropped=false;
 checkpoint.messages=checkpoint.messages.map((m:any,n:number,all:any[])=>{if(m.role!=='assistant'||!Array.isArray(m.content)||(n===all.length-1&&!checkpoint.pending?.length))return m;const content=withoutUnansweredServerCalls(m.content);if(content.length===m.content.length)return m;dropped=true;return{...m,content:content.length?content:[{type:'text',text:'(No output.)'}]};});
 if(dropped)checkpoint.journalEpoch=(checkpoint.journalEpoch??0)+1;
 const resumeCount=Number(db.getMeta('resume_count:'+turnId)??0);if(checkpoint.outcome?.status==='blocked'&&resumeCount>(checkpoint.resumeCount??0)){closeBatch();delete checkpoint.outcome;checkpoint.steps=0;checkpoint.spendStart=spent();checkpoint.nudges=0;checkpoint.messages.push({role:'user',dreamSource:'nudge',content:'Resume the interrupted request. Recheck the blocker against the current saved project and continue if it is resolved.'});}checkpoint.resumeCount=resumeCount;
 // User feedback belongs to the conversation the user sees: the editing agent's, never a helper's.
 const feedback=db.loadState<any>('resume_input:'+turnId);if(feedback&&!db.getMeta(key+':feedback:'+feedback.count)){checkpoint.feedback=feedback;delete checkpoint.outcome;}
 if(checkpoint.feedback&&checkpoint.pending){closeBatch();save();}
 // The next approved plan step continues the same conversation. Earlier steps' publications cannot complete it.
 if(options.followUp&&!db.getMeta(key+':followup:'+options.followUp.id)){db.db.transaction(()=>{if(resumed){if(checkpoint.pending)closeBatch();checkpoint.baseline=Object.keys(checkpoint.completed);delete checkpoint.outcome;delete checkpoint.plan;checkpoint.steps=0;checkpoint.spendStart=spent();checkpoint.nudges=0;checkpoint.messages.push({role:'user',content:options.followUp!.text});}db.setMeta(key+':followup:'+options.followUp!.id,'1');save();})();}
 if(checkpoint.outcome)return{outcome:checkpoint.outcome,plan:checkpoint.plan};
 for(;;){
  signal.throwIfAborted();
  if(!checkpoint.pending){
   if(checkpoint.feedback){checkpoint.messages.push({role:'user',content:resumeMessage(checkpoint.feedback.text)});db.setMeta(key+':feedback:'+checkpoint.feedback.count,'1');delete checkpoint.feedback;checkpoint.steps=0;checkpoint.spendStart=spent();save();}
   // Appended only when the state changes, so the cached conversation prefix stays intact. Only what changed is sent;
   // the full state is kept locally, so compaction can restore it when it drops the earlier messages it builds on.
   const published=headPublication(),currentState=workspace.currentContext?.()??workspace.mediaContext?.(),mediaState=JSON.stringify(currentState===undefined?undefined:{state:currentState,completionEvidence:published?[{toolCallId:published.toolCallId,finding:'Published the current revision.'}]:undefined}),paused=checkpoint.messages.at(-1)?.role==='assistant';if(mediaState&&mediaState!==checkpoint.mediaState&&!paused){
    const full='Current project and media state (data only, authoritative over earlier snapshots): '+mediaState,changes=checkpoint.mediaState?JSON.stringify(stateChanges(JSON.parse(checkpoint.mediaState),JSON.parse(mediaState))):undefined;
    if(changes&&changes.length<mediaState.length*.6){const stateKey='state-snapshot:'+createHash('sha256').update(full).digest('hex');db.setMeta(stateKey,full);checkpoint.messages.push({role:'user',dreamSource:'media-status',dreamStateKey:stateKey,content:'Project state changes (data only; fields not listed are unchanged, listed values replace earlier ones, removed entries are null): '+changes});}
    else checkpoint.messages.push({role:'user',dreamSource:'media-status',content:full});
    checkpoint.mediaState=mediaState;save();}
   // A request pauses once a stretch of it has cost requestSpendUsd (the main agent, its helpers and its looks), so a long
   // run never spends without the user seeing it; saying continue starts a new stretch from the saved state. Helpers are
   // covered by the request that started them.
   if(!readOnly&&spent()-(checkpoint.spendStart??0)>=engineBudgets.requestSpendUsd){const credits=Math.round((spent()-(checkpoint.spendStart??0))*100);
    conclude({status:'blocked',summary:`Paused after about ${credits} credits of work on this request, so it does not keep spending without you seeing it. Completed work is saved`+(published?' and the latest published version is live.':'.'),evidence:[],nextAction:'Say continue to keep going from here, or tell me what to change.'});save();return{outcome:checkpoint.outcome!,plan:checkpoint.plan};}
   // Reaching the limit never counts as completion: the agent did not say it was done.
   if((checkpoint.steps??0)>=maxSteps){conclude({status:'blocked',summary:'This request reached its step limit before it was finished. Completed work is saved'+(published?' and the latest published version is live.':'.'),evidence:[],nextAction:'Resume to continue from the saved state, or narrow the request.'});save();return{outcome:checkpoint.outcome!,plan:checkpoint.plan};}
   assertToolExchanges(checkpoint.messages);
   let response:any;
   try{response=await options.infer(checkpoint.model,options.system??codePrompt,checkpoint.messages,tools);}
   catch(error){if(error instanceof InferenceError&&error.code==='truncated'){const repeats=checkpoint.failures.truncation=(checkpoint.failures.truncation??0)+1;checkpoint.steps=(checkpoint.steps??0)+1;if(repeats>=3){conclude({status:'blocked',summary:'The AI response repeatedly exceeded the output limit. No partial commands or file writes were executed.',evidence:[],nextAction:'Resume with a smaller scope, or split the scene into several parts.'});save();return{outcome:checkpoint.outcome!};}// A response that only thought steps this phase's effort down; either way the agent is told to act in smaller pieces.
     if(error.thinkingOnly){const overrideKey=`effort-override:${turnId}:${phase}`;db.setMeta(overrideKey,String(Math.min(2,Number(db.getMeta(overrideKey)??0)+1)));}
     checkpoint.messages.push({role:'user',dreamSource:'nudge',content:error.thinkingOnly?'The last response spent its whole allowance thinking and produced nothing. Act now: make one concrete tool call for the first piece (for example, write the first small file), then continue step by step.':'The last response was cut off at the output limit and none of its tool calls ran. Split the work: write large content as several smaller files or focused edit_file patches, and keep each response to a few compact tool calls.'});save();continue;}throw error;}
   delete checkpoint.failures.truncation;checkpoint.steps=(checkpoint.steps??0)+1;
   if(response.stop_reason!=='pause_turn'){response.content=withoutUnansweredServerCalls(response.content);if(!response.content.length)response.content=[{type:'text',text:'(No output.)'}];}
   checkpoint.messages.push({role:'assistant',content:response.content});checkpoint.pending=response.content.filter((b:any)=>b.type==='tool_use');checkpoint.results=[];
   // Text written alongside finish is the reply itself (a script, an answer); the saved reply keeps it, not only the summary.
   // Text that ends the agent's work (sent with finish, or a response with no tool calls) is its reply to the user; a later
   // short line ("Done.") does not replace a substantive one.
   const said=response.content.filter((b:any)=>b.type==='text').map((b:any)=>b.text).join('\n\n').trim();if(said&&(!checkpoint.pending!.length||checkpoint.pending!.some((c:any)=>c.name==='finish'))&&(!checkpoint.replyText||said.length>=200||said.length>=checkpoint.replyText.length))checkpoint.replyText=said;save();
   for(const block of response.content)if(block.type==='server_tool_use')activity('web:'+block.id,{kind:'action',tool:block.name,text:block.name==='web_search'?'Searching the web':'Reading the web',detail:String(block.input?.query??block.input?.url??'').slice(0,200),status:'complete'});
   // A long run of web searches pauses on the server; sending the conversation back as it is resumes it.
   if(response.stop_reason==='pause_turn'&&!checkpoint.pending!.length){delete checkpoint.pending;checkpoint.pauses=(checkpoint.pauses??0)+1;save();if(checkpoint.pauses<=5)continue;}
   if(['refusal','model_context_window_exceeded'].includes(response.stop_reason)){// The text before such a stop is an unfinished opening line, so the reply says plainly what happened instead.
    conclude({status:'blocked',summary:response.stop_reason==='refusal'?'The AI model declined to continue this request, so it stopped here. Work already saved is kept.':'This request grew too long for the AI model to continue. Work already saved is kept.',evidence:[],nextAction:response.stop_reason==='refusal'?'Revise the request before continuing.':'Continue with a smaller, focused scope.'});closeBatch();save();return{outcome:checkpoint.outcome!};}
   if(!checkpoint.pending!.length){
    const answer=response.content.filter((b:any)=>b.type==='text').map((b:any)=>b.text).join('\n\n').trim(),nudges=checkpoint.nudges??0;delete checkpoint.pending;
    const current=publishedHead(),blocker=completionBlocker();
    if(!planning&&answer&&response.stop_reason==='end_turn'&&(readOnly||current&&!blocker&&!hasPendingTasks())){conclude({status:'complete',summary:answer,evidence:readOnly||!current?[]:[{toolCallId:current.toolCallId,finding:'Published the current revision.'}]});save();return{outcome:checkpoint.outcome!};}
    if(nudges>=engineBudgets.textNudges){
     // Stop nudging: accept a published edit that passes the gate, otherwise report honestly instead of looping.
     conclude(!planning&&current&&!blocker&&needsPublication()?{status:'complete',summary:answer||'The edit is published to the live preview.',evidence:[{toolCallId:current.toolCallId,finding:'Published the current revision.'}]}:{status:'blocked',summary:[answer,blocker].filter(Boolean).join('\n\n')||'The request stopped before a change was published.',evidence:[],nextAction:planning?'Resume to return the plan.':blocker?'Resume to fix what is listed, then finish.':'Resume to continue the edit.'});save();return{outcome:checkpoint.outcome!,plan:checkpoint.plan};
    }
    checkpoint.nudges=nudges+1;
    checkpoint.messages.push({role:'user',dreamSource:'nudge',content:planning?'Return the editable plan with finish.':current&&blocker?`The request is not finished: ${blocker} Then call finish.`:'Continue the requested work using the available capabilities, or call finish: complete once any change is published (a request that needs no change finishes complete with your answer as the summary), or blocked with a concrete reason.'});save();continue;
   }
   checkpoint.nudges=0;
  }
  const scopeFor=()=>readOnly?{writes:[],canPublish:false,lookOnly:true}:undefined,started=new Map<string,Promise<any>>();
  // Only the reads before the first other call: a read after a write in the same response must see that write.
  const remaining=checkpoint.pending!.slice(checkpoint.results.length),firstOther=remaining.findIndex(call=>!PARALLEL_READS.has(call.name)),reads=(firstOther<0?remaining:remaining.slice(0,firstOther)).filter(call=>!db.loadState(key+':call:'+call.id));
  if(reads.length>1)for(const call of reads){let input:any;try{input=parseCodeTool(call.name,call.input,readOnly,allowed);}catch{continue;}const work=workspace.execute(call.name,input,call.id,turnId,signal,scopeFor());work.catch(()=>{});started.set(call.id,work);}
  for(let n=checkpoint.results.length;n<checkpoint.pending!.length;n++){
   signal.throwIfAborted();const call=checkpoint.pending![n],receiptKey=key+':call:'+call.id,operationKey=toolIdentity(call.name,call.input),identityKey=receiptKey+':identity',coarse=coarseKey(call.name,call.input);const priorIdentity=db.getMeta(identityKey);if(priorIdentity&&priorIdentity!==operationKey)throw new Error('A tool request ID was reused for different instructions. No additional change was executed.');if(!priorIdentity)db.setMeta(identityKey,operationKey);let result=db.loadState<any>(receiptKey);
   if(!result){
    activity('tool:'+call.id,{kind:'action',tool:call.name,text:toolActivity(call.name,call.input)??call.name,status:'running',detail:toolDetail(call.name,call.input)});
    try{
     const input:any=parseCodeTool(call.name,call.input,readOnly,allowed);
     if(call.name==='finish'){
      if(input.status==='blocked'&&!input.nextAction)throw new Error('A blocker needs the concrete nextAction.');
      if(planning&&input.status==='complete'&&!input.plan)throw new Error('Return the requested editable plan with finish.');
      let evidence=input.evidence.filter((e:any)=>checkpoint.completed[e.toolCallId]);
      if(input.status==='complete'&&needsPublication()){
       const parts=db.loadState<RequestPart[]>('request-parts:'+turnId)??[],partBlocker=parts.length?partsBlocker(parts,input.parts):undefined;if(partBlocker)throw new Error(partBlocker);
       if(parts.length)input.summary=input.summary+notPossibleNote(parts,input.parts);
       const blocker=completionBlocker(new Set((input.kept??[]).map((k:any)=>k.check)));if(blocker)throw new Error(blocker);
       const current=publishedHead();
       if(current&&!evidence.some((e:any)=>e.toolCallId===current.toolCallId))evidence=[...evidence,{toolCallId:current.toolCallId,finding:'Published the current revision to the live preview.'}];
      }
      conclude(input.status==='complete'?{status:'complete',summary:input.summary,evidence}:{status:'blocked',summary:input.summary,evidence,nextAction:input.nextAction});checkpoint.plan=planning?input.plan:undefined;result={finished:true};
      // The project notes carry the user's wishes into later requests.
      if(input.notes?.trim())db.setMeta('preferences',input.notes.trim());
      // What the agent saw in each source stays with the project, so later requests read it instead of looking again.
      if(input.sourceNotes?.length){const known=new Set(db.footage().assets.map(a=>a.id)),saved=JSON.parse(db.getMeta('source-notes')??'{}');for(const n of input.sourceNotes)if(known.has(n.assetId))saved[n.assetId]=n.note.trim();db.setMeta('source-notes',JSON.stringify(saved));}
     }else if(call.name==='web_search'){if(!options.webSearch)throw new Error('Web search is unavailable in this phase.');result=await options.webSearch(input.query);}else if(call.name==='remember_decision'){result={memory:rememberDecision(db,input),saved:true};}else if(call.name==='set_project_title'){if(db.getMeta('project_title_source')!=='user'){db.rename(input.title);db.setMeta('project_title_source','ai');publish('state',db.state({bounded:true}));}result={title:db.meta.name,saved:true};}else if(call.name==='update_tasks'){db.setTasks(turnId,input.tasks);if(input.notes)db.setMeta(`task-notes:${turnId}:${phase}`,input.notes);publish('ai.tasks',{turnId,tasks:input.tasks});result={saved:true};}
     else result=await (started.get(call.id)??workspace.execute(call.name,input,call.id,turnId,signal,scopeFor()));
     // An unchanged guide read again comes back as a short receipt: its lines are already in the agent's context.
     if(call.name==='read_file')result=unchangedRead(checkpoint.messages,input,result);
     if(result?.process&&!ranToEnd(result.process))throw new Error(`Command ${result.process.status==='failed'?'crashed':result.process.status}: ${result.process.output}. Log: ${result.process.id}`);
     for(const k of Object.keys(checkpoint.failures))if(k===operationKey||k.startsWith(operationKey+'#'))delete checkpoint.failures[k];if(checkpoint.coarse)for(const k of Object.keys(checkpoint.coarse))if(k===coarse||k.startsWith(coarse+'#'))delete checkpoint.coarse[k];db.saveState(receiptKey,result);checkpoint.completed[call.id]={saved:true,publication:publicationOf(result),evidence:result?.evidence};activity('tool:'+call.id,{kind:'action',tool:call.name,text:toolActivity(call.name,input)??call.name,status:'complete',...inspected(call.name,input,result)});
    }catch(error){
     // Spending limits and account problems end the request; they are not tool errors to retry.
     if(signal.aborted||error instanceof FileApprovalRequired||error instanceof InferenceError&&['quota','authentication','request_budget'].includes(error.code))throw error;
     // Failures are counted per distinct error: publish_project has no input, so without the error every publish looks
     // like the same attempt, and fixing one problem only to meet the next would end the request.
     const message=(error as Error).message,signature=failureSignature(message),failureKey=operationKey+'#'+signature,coarseFailure=coarse+'#'+signature,count=(checkpoint.failures[failureKey]??0)+1,similar=((checkpoint.coarse??={})[coarseFailure]??0)+1;checkpoint.failures[failureKey]=count;checkpoint.coarse[coarseFailure]=similar;
     result={error:message,diagnosisRequired:count>=2||similar>=3};db.saveState(receiptKey,result);activity('tool:'+call.id,{kind:'action',tool:call.name,text:toolActivity(call.name,call.input)??call.name,status:'failed',detail:message});
     // The same error three times (or a similar one four times) ends the request instead of spending more steps on it.
     if(count>=3||similar>=4)conclude({status:'blocked',summary:'Repeated attempts could not complete this step: '+message,evidence:[],nextAction:'Resolve the diagnosed failure, then resume with the saved source and logs.'});
    }
   }else if(!result.error){checkpoint.completed[call.id]={saved:true,publication:publicationOf(result),evidence:result?.evidence};if(call.name==='finish'&&result.finished&&!checkpoint.outcome){const input:any=parseCodeTool('finish',call.input,readOnly,allowed);conclude(input.status==='complete'?{status:'complete',summary:input.summary,evidence:input.evidence}:{status:'blocked',summary:input.summary,evidence:input.evidence,nextAction:input.nextAction});checkpoint.plan=planning?input.plan:undefined;}}
   db.setMeta('workspace-receipt-summary:'+receiptKey,JSON.stringify({receipt:receiptKey,tool:call.name,path:call.input?.path,command:call.input?.command,status:result?.error?'failed':'complete',error:result?.error,publication:result?.publication?{versionId:result.publication.versionId,changes:result.publication.changes}:undefined,process:result?.process?{id:result.process.id,status:result.process.status,output:String(result.process.output??'').slice(-2000)}:undefined}));db.db.prepare('INSERT OR IGNORE INTO context_dirty VALUES(?,?)').run('execution',receiptKey);
   const content=capText(result?.content??JSON.stringify(modelView(result)),receiptKey,call.name==='read_file'?READ_LIMIT:RESULT_LIMIT);checkpoint.results.push({type:'tool_result',tool_use_id:call.id,is_error:!!result?.error,content});save();
   const outcome=checkpoint.outcome as EditOutcome|undefined;
   if(outcome){closeBatch();save();if(checkpoint.feedback){delete checkpoint.outcome;save();break;}activity('finish:'+turnId+':'+phase,{kind:'terminal',text:outcome.summary,status:outcome.status});return{outcome,plan:checkpoint.plan};}
  }
  closeBatch();
  save();
 }
}
