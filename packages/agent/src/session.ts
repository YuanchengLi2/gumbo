import {randomUUID} from 'node:crypto';
import {models,engineBudgets,agentModels,autoModel,autoFallback,type ModelChoice,type Provider} from '@dream/config';
import {STOPPED_WHEN_CLOSED,type ProjectDB} from '@dream/project-db';
import {selectionRefs} from '@dream/timeline';
import {approvesPlan,type TaskPlan} from '@dream/contracts';
import {infer,type CallInput,type Dependencies,type InferenceResponse} from './transport';
import {InferenceError,FileApprovalRequired} from './errors';
import {systemPrompt,modeNote} from './prompt';
import {toolDefinitions,parseTool,parallelTools,type ToolName} from './tools';
import {estimateTokens,cutPoint,transcriptOf,summarySystem,compacted,SUMMARY_MARK,type Message} from './compact';
import {proposePlan,acceptPlan,approvedPlanMessage,planTasks} from './plans';
import {toolActivity,toolDetail} from './activity';
import {newCredits} from './credits';
import {searchPrompt,searchReport} from './web-search';
import {withoutUnansweredServerCalls} from './tool-exchanges';
import type {ProviderConnection} from './provider-session';

/** Roux: one agent, one loop, for every request. A message joins the project's one continuing conversation; the model
 * is called; the tools it asks for run; their results go back; and that repeats until it answers without asking for a
 * tool. Nothing classifies the request first, nothing gates how it finishes, nothing nudges it along. The model decides
 * what to do; the harness keeps it safe (spending and time pauses, a runaway cap, stall fallback, stop and resume without
 * running anything twice) and keeps the conversation small enough (compaction) and cached. */

export type Mode='edit'|'plan'|'ask';
export type Effort='auto'|'low'|'medium'|'high';
export interface AgentHost{
 /** Readies the workspace (folders, guides, footage files). Called before each run. */
 initialize():Promise<void>;
 /** The conversation's opening context: the project memory (GUMBO.md), the footage index and the environment; known: the
  * footage ids it describes. */
 sessionContext():{text:string;known:string[]};
 /** What a new message needs beside it: what is selected, attached media, mentions, the user's own changes since the
  * agent's last edit, and footage that arrived since the conversation last heard about footage. known: footage ids the
  * conversation already knows. */
 messageContext(input:{turnId:string;text:string;selection:string[];assetIds:string[];known:string[]}):{text:string;known:string[]};
 /** Runs one tool call. readOnly: plan mode, answers and helpers, which change nothing. */
 tool(name:string,input:any,context:{callId:string;turnId:string;signal:AbortSignal;readOnly:boolean}):Promise<unknown>;
 runningCommands?():{id:string;command:string;runningSec:number}[];
}
/** journalEpoch: saved messages are kept as an append-only journal; a change to an earlier message (words added to the
 * last one, a compaction) starts a new one. */
type Session={id:string;model:string;auto:boolean;effort:Effort;messages:Message[];known:string[];turns:Record<string,number>;compactions:number;createdAt:string;journalEpoch?:number;
 /** The conversation's size as the model last counted it: its first messages, and their tokens. */
 measured?:{messages:number;tokens:number}};
type Run={turnId:string;mode:Mode;startedAt:number;spentAtStart:number;steps:number;nudges:number};
const SESSION='agent-session';
const RESULT_LIMIT=20_000,STEP_LIMIT=150,SUBAGENT_STEPS=40;
const purposeOf=(mode:Mode)=>mode==='plan'?'planning':mode==='ask'?'answering':'execution';

export class Agent {
 private controller:AbortController|null=null;
 /** The network and clock calls use (tests stand in a gateway and skip the waits). */
 dependencies:Dependencies={};
 private providers?:{at:number;value:Partial<Record<Provider,boolean>>};
 constructor(private db:ProjectDB,private connection:(signal?:AbortSignal)=>Promise<ProviderConnection>,private publish:(type:string,payload:any)=>void,private host:AgentHost){}
 get running(){return!!this.controller;}
 cancel(reason:'user'|'shutdown'='user'){this.controller?.abort(Object.assign(new DOMException(reason==='user'?'Stopped by you.':'Project closed.','AbortError'),{dreamStop:reason}));}
 private signal(){return this.controller?.signal??new AbortController().signal;}

 // ---- Entry points (the app's commands) ----

 /** A message from the composer. intent: auto (do it), plan (plan first), ask (answer only). */
 async message(text:string,selection:string[]=[],intent:'auto'|'plan'|'ask'='auto',assetIds:string[]=[],requestId?:string,effort?:Effort,model?:ModelChoice):Promise<void>{
  if(this.running)throw new Error('An edit is already running.');
  const turnId=requestId??randomUUID();if(this.db.getMeta('submitted:'+turnId))return;
  if(model==='auto')await this.refreshProviders();
  // A plan is waiting: a go-ahead ("do it") approves it, anything else asks for a changed plan.
  const waiting=this.db.getMeta('ai_status')==='awaiting_approval'?this.db.loadState<any>('task_plan'):undefined;
  if(waiting?.plan&&intent==='auto'&&approvesPlan(text)){this.db.message('user',text,waiting.turnId);return this.approvePlan(waiting.plan,waiting.versionId,turnId,waiting.revision,effort,model);}
  const mode:Mode=intent==='plan'||waiting?.plan&&intent==='auto'?'plan':intent==='ask'?'ask':'edit';
  this.db.db.transaction(()=>{
   this.db.userMessage(text,turnId,assetIds,selectionRefs(this.db.timeline(),this.db.footage(),selection));
   this.db.setMeta('pending_request',JSON.stringify({text,selection,intent,assetIds,turnId,mode}));this.db.setMeta('submitted:'+turnId,'1');
  })();
  await this.lifecycle(turnId,async()=>{await this.prepare(effort,model);await this.converse(turnId,mode,{text,selection,assetIds});});
 }
 /** The user approved a plan (as proposed, or with their changes saved): the conversation carries it out. */
 async approvePlan(plan:TaskPlan,expectedVersionId:string,requestId:string,expectedPlanRevision?:number,effort?:Effort,model?:ModelChoice):Promise<void>{
  if(this.running)throw new Error('An edit is already running.');
  if(model==='auto')await this.refreshProviders();
  const accepted=acceptPlan(this.db,plan,expectedVersionId,requestId,expectedPlanRevision);if(accepted.replayed)return;
  this.db.setMeta('pending_request',JSON.stringify({text:accepted.plan.goal,selection:accepted.selection,intent:'auto',assetIds:[],turnId:accepted.turnId,mode:'edit'}));
  const tasks=planTasks(accepted.plan);this.db.setTasks(accepted.turnId,tasks);this.publish('ai.tasks',{turnId:accepted.turnId,tasks});
  await this.lifecycle(accepted.turnId,async()=>{await this.prepare(effort,model);await this.converse(accepted.turnId,'edit',{text:approvedPlanMessage(accepted.plan),selection:accepted.selection,assetIds:[],silent:true});});
 }
 /** Carry on after a stop, a pause or a file permission, with optional words from the user. */
 async resume(text?:string):Promise<void>{
  if(this.running)throw new Error('An edit is already running.');
  const pending=this.db.loadState<any>('pending_request');if(!pending)throw new Error('There is nothing to continue.');
  const status=this.db.getMeta('ai_status');
  if(status==='complete'&&text?.trim())return this.message(text,pending.selection??[],'auto',pending.assetIds??[]);
  if(status==='awaiting_approval')throw new Error('A plan is waiting: approve it or say what to change.');
  const turnId=pending.turnId,mode:Mode=pending.mode??'edit';
  if(text?.trim())this.db.message('user',text,turnId);
  this.db.setMeta('code-reported:'+turnId,'');this.db.setMeta('file_wait','');
  // Without a conversation to carry on (a request from before this version of Gumbo), the request starts one.
  const fresh=!this.session()?.messages.length,words=fresh?[pending.text,text?.trim()].filter(Boolean).join('\n\n'):text?.trim()||'';
  await this.lifecycle(turnId,async()=>{await this.prepare();await this.converse(turnId,mode,{text:words,selection:pending.selection??[],assetIds:pending.assetIds??[],resume:!fresh});});
 }
 async availableProviders(){await this.refreshProviders();return{anthropic:true,...this.enabledProviders()};}
 /** One standalone model call for the app's helpers (hearing sound, describing shots, writing footage overviews). Work in
  * the background passes its own signal, so stopping a request never stops it. */
 async inference(model:string,system:string,messages:unknown[],tools:unknown[]=[],turnId?:string,purpose='helper',phase='helper',signal?:AbortSignal){
  return this.call({model,system,messages,tools,turnId,purpose,phase,max_tokens:8192,profile:profile('low')},signal);
 }

 // ---- The conversation ----

 /** The conversation as saved, as a copy to change (saved state comes back read-only). */
 private session():Session|undefined{const saved=this.db.loadState<Session>(SESSION);return saved?structuredClone(saved):undefined;}
 private save(session:Session){this.db.saveState(SESSION,session);}
 /** The model and effort for what comes next: the composer's pick, else what the conversation already uses. */
 private async prepare(effort?:Effort,choice?:ModelChoice){
  const existing=this.session(),model=choice?this.modelFor(choice):existing?.model??this.modelFor(undefined);
  const next:Session=existing??{id:randomUUID(),model,auto:choice==='auto',effort:effort??'auto',messages:[],known:[],turns:{},compactions:0,createdAt:new Date().toISOString()};
  next.model=model;if(choice)next.auto=choice==='auto';if(effort)next.effort=effort;this.save(next);
 }
 private modelFor(choice?:ModelChoice):string{
  if(!choice)return models.agent;
  return choice==='auto'?autoModel(this.enabledProviders()):agentModels[choice];
 }
 /** Adds the request (or the user's words on a resume) to the conversation and runs the loop. */
 private async converse(turnId:string,mode:Mode,request:{text:string;selection:string[];assetIds:string[];resume?:boolean;silent?:boolean}){
  await this.host.initialize();
  const session=this.session()!;
  this.closeOpenCalls(session,'Not run: the request was stopped before this ran.',request.resume);
  if(!request.resume||request.text){
   // A new conversation opens with the project as it is now; it stays byte for byte the same after, so it stays cached.
   const start=session.messages.length?undefined:this.host.sessionContext();if(start)session.known=start.known;
   const context=request.resume?{text:'',known:session.known}:this.host.messageContext({turnId,text:request.text,selection:request.selection,assetIds:request.assetIds,known:session.known});
   session.known=context.known;
   const words=[request.text,context.text].filter(Boolean).join('\n\n')+(request.resume?'':modeNote(mode));
   if(start)session.messages.push({role:'user',content:[{type:'text',text:start.text,cache_control:{type:'ephemeral'}},{type:'text',text:words}]});
   else this.addUser(session,[{type:'text',text:words}]);
   session.turns[turnId]??=session.messages.length-1;
  }else if(session.messages.at(-1)?.role==='assistant'&&!(session.messages.at(-1)!.content as any[]).some((b:any)=>b.type==='tool_use'))this.addUser(session,[{type:'text',text:'Continue.'}]);
  this.save(session);
  const phase=mode==='plan'?'planning':mode==='ask'?'answering':'editing';this.db.setPhase(turnId,phase);this.publish('ai.phase',{turnId,phase});
  await this.loop(session,{turnId,mode,startedAt:Date.now(),spentAtStart:this.db.turnUsage(turnId).costUsd,steps:0,nudges:0},request.selection);
 }
 /** A user turn is added to the last user message when the conversation ends on one (tool results), so turns alternate. */
 private addUser(session:Session,blocks:any[]){const last=session.messages.at(-1);if(last?.role==='user')session.journalEpoch=(session.journalEpoch??0)+1;if(last?.role==='user')last.content=[...(Array.isArray(last.content)?last.content:[{type:'text',text:last.content}]),...blocks];else session.messages.push({role:'user',content:blocks});}
 /** Tool calls the conversation asked for but never got results for (a stop mid-step): a resume runs them; anything else
  * closes them with a note, since every call needs its result before the conversation can go on. */
 private closeOpenCalls(session:Session,note:string,resume?:boolean){
  const last=session.messages.at(-1);if(resume||last?.role!=='assistant')return;
  const open=(last.content as any[]).filter((b:any)=>b.type==='tool_use');if(!open.length)return;
  session.messages.push({role:'user',content:open.map((b:any)=>({type:'tool_result',tool_use_id:b.id,content:note,is_error:true}))});
 }
 private async loop(session:Session,run:Run,selection:string[]){
  const tools=toolDefinitions(),signal=this.signal();
  for(;;){
   signal.throwIfAborted();this.guard(run);
   // A stop in the middle of running tools: the calls without results run first.
   const last=session.messages.at(-1);
   if(last?.role==='assistant'&&(last.content as any[]).some((b:any)=>b.type==='tool_use')){
    const outcome=await this.runTools(session,run,(last.content as any[]).filter((b:any)=>b.type==='tool_use'),selection);
    session.messages.push({role:'user',content:outcome.results});this.save(session);
    if(outcome.planned)return;continue;
   }
   await this.compactIfNeeded(session,run.turnId);
   let response:InferenceResponse;
   try{response=await this.call({model:session.model,system:systemPrompt(session.model),tools,messages:session.messages,turnId:run.turnId,purpose:purposeOf(run.mode),phase:'main',max_tokens:allowance(session.effort),profile:profile(session.effort)},signal);}
   catch(error){
    // A reply that spent its whole allowance thinking: say so and let it act, at most twice in a run.
    if(error instanceof InferenceError&&error.thinkingOnly&&run.nudges<2){run.nudges++;this.addUser(session,[{type:'text',text:'(Your last reply ran out of room while thinking, before acting. Take the next step now, and keep each step small.)'}]);this.save(session);continue;}
    // Auto's model stopped responding twice: its other model takes over. A model the user picked is never switched.
    if(error instanceof InferenceError&&error.code==='stalled'&&session.auto){const next=autoFallback(session.model,this.enabledProviders());if(next&&next!==session.model){this.db.event('ai.model_fallback',{turnId:run.turnId,from:session.model,to:next});session.model=next;this.save(session);continue;}}
    throw error;
   }
   run.steps++;
   const usage=(response as any).usage;if(usage)session.measured={messages:session.messages.length,tokens:(usage.input_tokens??0)+(usage.cache_read_input_tokens??0)+(usage.cache_creation_input_tokens??0)};
   // A server tool call the provider left without a result could never be sent back: it is dropped.
   session.messages.push({role:'assistant',content:withoutUnansweredServerCalls(response.content)});this.save(session);
   const calls=response.content.filter((b:any)=>b.type==='tool_use');
   if(!calls.length){this.finish(run,response.content);return;}
  }
 }
 /** The harness's limits: spending pauses every so often so a long job never runs away with the user's credits, a run
  * pauses after a while so they can look, and a runaway loop is stopped. Each pause keeps everything; continue goes on. */
 private guard(run:Run){
  const spent=this.db.turnUsage(run.turnId).costUsd-run.spentAtStart,minutes=(Date.now()-run.startedAt)/60_000;
  if(spent>=engineBudgets.requestSpendUsd)throw new PauseError(`I've paused to check in: this part used about ${Math.max(1,Math.round(spent*100))} credits. Say continue to keep going.`);
  if(minutes>=engineBudgets.requestMinutes)throw new PauseError(`I've paused after ${Math.round(minutes)} minutes so you can look at the edit so far. Say continue to keep going.`);
  if(run.steps>=STEP_LIMIT)throw new PauseError('I\'ve paused after a long stretch of steps. Say continue to keep going, or tell me what to focus on.');
 }
 /** The model answered without asking for a tool: its words are the reply. */
 private finish(run:Run,content:any[]){
  const text=content.filter((b:any)=>b.type==='text').map((b:any)=>b.text).join('').trim()||(run.mode==='edit'?'Done.':'');
  const start=this.db.getMeta('turn_start_version')??undefined,edited=!!start&&start!==this.db.head();
  const credits=edited?newCredits(this.db,start):undefined,reply=credits?`${text}\n\n${credits}`:text;
  if(!this.db.getMeta('code-reported:'+run.turnId)){this.db.message('assistant',reply,run.turnId,{status:'complete',summary:reply,kind:edited?'completion':'answer'});this.db.setMeta('code-reported:'+run.turnId,'1');}
  this.db.setMeta('ai_status','complete');this.publish('ai.status',{status:'complete'});
 }

 // ---- Tools ----

 private async runTools(session:Session,run:Run,calls:any[],selection:string[]):Promise<{results:any[];planned:boolean}>{
  const results:any[]=new Array(calls.length);let planned=false;
  for(let i=0;i<calls.length;){
   // Calls that only look run together; anything that changes something runs on its own, in order.
   let j=i+1;if(parallelTools.has(calls[i].name))while(j<calls.length&&parallelTools.has(calls[j].name))j++;
   await Promise.all(calls.slice(i,j).map(async(call,k)=>{
    const outcome=await this.runTool(session,run,call,selection);results[i+k]=outcome.block;if(outcome.planned)planned=true;
   }));
   i=j;
  }
  return{results,planned};
 }
 private activity(turnId:string,id:string,patch:any){const event=this.db.activityEvent(turnId,{id,...patch});if(event)this.publish('ai.activity',{turnId,event});}
 private async runTool(session:Session,run:Run,call:any,selection:string[]):Promise<{block:any;planned?:boolean}>{
  const receiptKey='agent-call:'+call.id,saved=this.db.loadState<any>(receiptKey);
  if(saved)return{block:saved.block,planned:saved.planned};
  const signal=this.signal(),readOnly=run.mode!=='edit',id='tool:'+call.id;
  let input:any;
  try{input=parseTool(call.name,call.input,{planning:run.mode==='plan',readOnly:run.mode==='ask'});}
  catch(error){return{block:resultBlock(call.id,(error as Error).message,true)};}
  this.activity(run.turnId,id,{kind:'action',tool:call.name,text:toolActivity(call.name,input)??call.name,status:'running',detail:toolDetail(call.name,input)});
  let block:any,planned=false;
  try{
   const output=await this.execute(call.name as ToolName,input,{callId:call.id,turnId:run.turnId,signal,readOnly,selection,session});
   if(call.name==='propose_plan')planned=true;
   block=resultBlock(call.id,output,false);
   // Media the call imported or looked at shows on its row as thumbnails.
   const media=output&&typeof output==='object'&&Array.isArray((output as any).media)?(output as any).media.slice(0,24):undefined;
   this.activity(run.turnId,id,{kind:'action',tool:call.name,text:toolActivity(call.name,input)??call.name,status:'complete',...(media?.length?{media}:{})});
  }catch(error){
   if(error instanceof FileApprovalRequired||signal.aborted)throw error;
   block=resultBlock(call.id,(error as Error).message||String(error),true);
   this.activity(run.turnId,id,{kind:'action',tool:call.name,text:toolActivity(call.name,input)??call.name,status:'failed',detail:String((error as Error).message??error).slice(0,300)});
  }
  this.db.saveState(receiptKey,{block,planned});
  return{block,planned};
 }
 private async execute(name:ToolName,input:any,context:{callId:string;turnId:string;signal:AbortSignal;readOnly:boolean;selection:string[];session:Session}):Promise<unknown>{
  if(name==='todo'){this.db.setTasks(context.turnId,input.tasks.map((t:any)=>({...t,evidence:[]})));this.publish('ai.tasks',{turnId:context.turnId,tasks:input.tasks});return 'Saved.';}
  if(name==='title'){
   if(this.db.getMeta('project_title_source')==='user')return 'The user named this project; the title stays.';
   this.db.rename(input.title);this.db.setMeta('project_title_source','ai');this.publish('state',this.db.state({bounded:true}));return 'Named.';
  }
  if(name==='propose_plan'){const {progress:_p,...plan}=input;proposePlan(this.db,context.turnId,plan,context.selection);return 'Proposed. The user reviews it now; stop here.';}
  if(name==='task')return this.subagent(input.prompt,context);
  if(name==='web'&&input.query)return this.webSearch(input.query,context.turnId);
  return this.host.tool(name,input,{callId:context.callId,turnId:context.turnId,signal:context.signal,readOnly:context.readOnly});
 }
 /** A helper with its own fresh conversation: it looks and reads (never changes anything) and reports back, so a wide
  * investigation never fills the main conversation. It shares the system prompt, tools and session start, so its calls
  * read the same cached prefix. */
 private async subagent(prompt:string,context:{callId:string;turnId:string;signal:AbortSignal;session:Session}){
  const session=context.session,tools=toolDefinitions(),opening=(session.messages[0]?.content as any[])?.[0]?.text??this.host.sessionContext().text;
  const messages:Message[]=[{role:'user',content:[{type:'text',text:opening,cache_control:{type:'ephemeral'}},{type:'text',text:`You are helping the editor with one part of the user's request. Look and read only (nothing can be changed from here), then reply with a short report: what you found, with exact times, sources and quotes, and what you are unsure of. The editor reads only your final reply.\n\nTask: ${prompt}`}]}];
  let lastText='';
  for(let step=0;step<SUBAGENT_STEPS;step++){
   context.signal.throwIfAborted();
   const response=await this.call({model:session.model,system:systemPrompt(session.model),tools,messages,turnId:context.turnId,purpose:'subagent',phase:'task:'+context.callId,max_tokens:allowance(session.effort),profile:profile(session.effort)},context.signal);
   messages.push({role:'assistant',content:response.content});
   const text=response.content.filter((b:any)=>b.type==='text').map((b:any)=>b.text).join('').trim();if(text)lastText=text;
   const calls=response.content.filter((b:any)=>b.type==='tool_use');
   if(!calls.length)return lastText||'The helper found nothing to report.';
   const results=await Promise.all(calls.map(async(call:any)=>{
    try{const input=parseTool(call.name,call.input,{readOnly:true});if(call.name==='task'||call.name==='todo')throw new Error('A helper only looks and reads; report what you found instead.');
     const output=call.name==='web'&&input.query?await this.webSearch(input.query,context.turnId):await this.host.tool(call.name,input,{callId:`${context.callId}:${call.id}`,turnId:context.turnId,signal:context.signal,readOnly:true});
     return resultBlock(call.id,output,false);}
    catch(error){if(error instanceof FileApprovalRequired||context.signal.aborted)throw error;return resultBlock(call.id,(error as Error).message,true);}
   }));
   messages.push({role:'user',content:results});
   if(estimateTokens(messages)>contextTarget(session.model))return(lastText?lastText+'\n\n':'')+'(The helper stopped here: it had read as much as it can hold. Ask it about a smaller part for more.)';
  }
  return(lastText?lastText+'\n\n':'')+'(The helper reached its step limit; this is what it found.)';
 }
 /** Web search answered by a small call with Anthropic's server-side search, for every model. */
 private async webSearch(query:string,turnId:string){
  const messages:any[]=[{role:'user',content:query}],found:any[]=[];
  // A search that pauses (a long server-side turn) is sent back as it is to carry on, a few times at most.
  for(let n=0;n<4;n++){
   const response=await this.call({model:agentModels.haiku,system:searchPrompt,messages,tools:[{type:'web_search_20250305',name:'web_search',max_uses:3}],turnId,purpose:'web_search',phase:'web',max_tokens:4096,profile:profile('low')},this.signal());
   found.push(...response.content);
   if(response.stop_reason!=='pause_turn')break;
   messages.push({role:'assistant',content:response.content});
  }
  return searchReport(query,found);
 }

 // ---- Context size ----

 /** Compacts when the conversation passes its budget (estimated from its text, pictures at a fixed price), deep enough
  * that the next compaction is far away: the summary and about a quarter of the budget of recent exchanges stay. The size
  * is the model's own count from its last call plus an estimate of what came since: estimating every picture at a fixed
  * price overcounted frames several times, and a look-heavy request (reframing) was summarized twice, 38 s of waiting. */
 private async compactIfNeeded(session:Session,turnId:string){
  const target=contextTarget(session.model),measured=session.measured&&session.measured.messages<=session.messages.length?session.measured:undefined;
  const size=measured?measured.tokens+estimateTokens({messages:session.messages.slice(measured.messages)}):estimateTokens({messages:session.messages});
  if(size<=target)return;
  const cut=cutPoint(session.messages,Math.round(target*.25));if(cut<2)return;
  const first=session.messages[0],earlier=(Array.isArray(first.content)?first.content:[]).find((b:any)=>b.type==='text'&&String(b.text).startsWith(SUMMARY_MARK))?.text;
  const transcript=(earlier?`${earlier}\n\n`:'')+transcriptOf(session.messages.slice(1,cut));
  this.activity(turnId,'compaction:'+session.compactions,{kind:'action',text:'Tidying up my notes',status:'running'});
  let summary:string;
  try{
   const response=await this.call({model:agentModels.haiku,system:summarySystem,messages:[{role:'user',content:transcript.slice(-400_000)}],tools:[],turnId,purpose:'compaction',phase:'compaction',max_tokens:3000,profile:profile('low')},this.signal());
   summary=response.content.filter((b:any)=>b.type==='text').map((b:any)=>b.text).join('').trim();
  }catch(error){if(this.signal().aborted)throw error;summary='';}
  // Without a summary the older part is still dropped, with its requests kept, so the conversation never outgrows the model.
  if(!summary)summary=transcriptOf(session.messages.slice(1,cut)).split('\n').filter(l=>l.startsWith('USER:')).join('\n').slice(-8000);
  session.messages=compacted(session.messages,cut,summary);session.compactions++;session.journalEpoch=(session.journalEpoch??0)+1;session.measured=undefined;
  for(const [turn,index] of Object.entries(session.turns))session.turns[turn]=Math.max(0,index-cut+1);
  this.save(session);this.db.event('ai.compacted',{turnId,from:size,to:estimateTokens({messages:session.messages})});
  this.activity(turnId,'compaction:'+(session.compactions-1),{kind:'action',text:'Tidying up my notes',status:'complete'});
 }

 // ---- Calls, providers, lifecycle ----

 private async call(input:CallInput,signal?:AbortSignal){
  return infer({db:this.db,config:await this.connection(signal),connect:()=>this.connection(signal),input,signal,publish:this.publish},this.dependencies);
 }
 private async refreshProviders(){
  if(this.providers&&Date.now()-this.providers.at<600_000)return;
  try{const config=await this.connection(this.controller?.signal),response=await (this.dependencies.fetch??fetch)(config.url+'/providers',{headers:{Authorization:'Bearer '+config.token},signal:AbortSignal.timeout(5000)});
   const value=response.ok?await response.json() as Partial<Record<Provider,boolean>>:{};this.providers={at:Date.now(),value};}catch{this.providers={at:Date.now()-540_000,value:{}};}
 }
 /** Providers with a key on the gateway, without those switched off in Settings. Claude always runs. */
 private enabledProviders():Partial<Record<Provider,boolean>>{const off=new Set((process.env.DREAM_DISABLED_PROVIDERS??'').split(',').filter(Boolean));return Object.fromEntries(Object.entries(this.providers?.value??{}).map(([id,on])=>[id,!!on&&!off.has(id)]));}
 private async lifecycle(turnId:string,work:()=>Promise<void>){
  this.controller=new AbortController();this.db.setMeta('ai_status','running');
  const startedAt=new Date().toISOString();this.db.setMeta('run_started_at',startedAt);this.publish('ai.status',{status:'running',startedAt});
  try{await work();}
  catch(error){
   const permission=error instanceof FileApprovalRequired,status=permission?'awaiting_file_permission':'interrupted';this.db.setMeta('ai_status',status);
   if(permission)this.db.setMeta('file_wait',JSON.stringify((error as FileApprovalRequired).proposal?{kind:'approval',proposal:(error as FileApprovalRequired).proposal}:{kind:'permission'}));
   else{
    const stopped=this.controller.signal.aborted,message=stopped?(this.controller.signal.reason?.dreamStop==='shutdown'?STOPPED_WHEN_CLOSED:'Stopped.'):(error as Error).message;
    this.db.message('assistant',message,turnId,error instanceof PauseError?{status:'paused',summary:message,kind:'pause'}:undefined);
    if(!stopped&&!(error instanceof PauseError))this.publish('ai.error',{message,...(error instanceof InferenceError?{code:error.code}:{})});
   }
   this.publish('ai.status',{status});
  }finally{this.controller=null;this.publish('state',this.db.state({bounded:true}));this.publish('ai.turn_end',{turnId});}
 }
}

/** A pause the harness makes (spending, time, a long run): the work so far is kept and continue goes on. */
export class PauseError extends Error {}
function profile(effort:Effort){return{version:1,role:'editor',complexity:'normal',effort:effort==='auto'?'medium':effort,reason:'Do what the request needs.'};}
const allowance=(effort:Effort)=>effort==='low'?16_384:32_768;
/** How large a conversation grows before it is compacted: Haiku smaller, to stay out of its long-context price. */
export const contextTarget=(model:string)=>model.startsWith('claude-haiku')?engineBudgets.haikuInput:engineBudgets.workingInput;
/** A tool's output as the result the model reads: pictures stay pictures, everything else is text, cut to a size that
 * keeps the conversation small (paging tools say how to read more). */
function resultBlock(id:string,output:unknown,isError:boolean){
 const cap=(text:string)=>text.length>RESULT_LIMIT?text.slice(0,RESULT_LIMIT)+`\n… (cut here: ${text.length-RESULT_LIMIT} more characters. Read a smaller part with offset and limit, or grep for what you need.)`:text;
 if(output&&typeof output==='object'&&Array.isArray((output as any).content))return{type:'tool_result',tool_use_id:id,content:(output as any).content.map((b:any)=>b.type==='text'?{type:'text',text:cap(String(b.text))}:b),...(isError?{is_error:true}:{})};
 const text=typeof output==='string'?output:output===undefined?'Done.':JSON.stringify(output);
 return{type:'tool_result',tool_use_id:id,content:cap(text)||'Done.',...(isError?{is_error:true}:{})};
}
