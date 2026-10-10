import {computerFiles,ComputerReadSchema,fileReadTools,FileApprovalRequired} from './file-tools';
import type {FileService} from '@dream/contracts';
import {BlockedEditError} from './outcomes';
import {historyTools,isHistoryTool,executeHistoryTool,compactConversation,boundedToolResult} from './conversation';
import {ProjectContext,ProjectReadSchema,contextTools} from './context';
import {z} from 'zod';
import {consultTool} from './director-consult';
import type {ProjectDB} from '@dream/project-db';
import {footageTools,executeFootageTool,isFootageTool,footageResultContent} from './footage-tools';

type Content={type:string;text?:string;id?:string;name?:string;input?:unknown};
type Checkpoint={journalEpoch?:number;messages:any[];pending:Content[]|null;reads:number;requests:number;done:boolean;processed?:number;results?:any[];resume?:number;text?:string;value?:unknown};
/** Persist model responses before executing independent, read-only local tools. */
export async function readLoop(options:{db:ProjectDB;key:string;prompt:string;system:string;model:string;turnId:string;signal?:AbortSignal;handoff?:boolean;files?:FileService;consult?:(question:string,attempts:string|undefined,key:string)=>Promise<unknown>;inference:(model:string,system:string,messages:unknown[],tools:unknown[],turnId:string)=>Promise<{content:Content[]}>;finish?:{name:string;tool:unknown;parse:(input:unknown)=>unknown}}){
 const {db,key,prompt,system,model,turnId,signal,inference,finish}=options,saved=db.loadState<Checkpoint>(key);
 const state:Checkpoint=saved?saved:{messages:[{role:'user',content:prompt}],pending:null,reads:0,requests:0,done:false};
 const resume=Number(db.getMeta('resume_count:'+turnId)??0);if(resume>(state.resume??0)){state.reads=0;state.requests=0;state.resume=resume;}
 const save=()=>db.saveState(key,state);save();
 while(!state.done&&(state.requests<16||state.pending)){
  signal?.throwIfAborted();
  if(!state.pending){const tools=[...(options.handoff?[{name:'request_execution',description:'Hand this request to the executing editor when any requested work requires timeline or generated-media changes. The editor has mutation tools and can consult Opus. Do not say the app cannot edit.',input_schema:{type:'object',properties:{instruction:{type:'string'}},required:['instruction'],additionalProperties:false}}]:[]),...(state.reads<12?[...(options.files?fileReadTools:[]),...(options.consult?[consultTool]:[]),...contextTools,{name:'get_project',description:'Read a bounded page of timeline, assets or plan.',input_schema:z.toJSONSchema(ProjectReadSchema,{target:'draft-7'})},...footageTools,...historyTools]:[]),...(finish?[finish.tool]:[])];const response=await inference(model,system+(state.reads>=12?' Your local read budget is exhausted; finish from verified evidence or explicitly ask for missing information.':''),state.messages,tools,turnId);state.pending=response.content;state.results=[];state.processed=0;state.requests++;state.messages.push({role:'assistant',content:response.content});save();}
  const calls=state.pending.filter(c=>c.type==='tool_use');
  if(!calls.length){state.text=state.pending.filter(c=>c.type==='text').map(c=>c.text).join('\n');state.done=true;state.pending=null;save();break;}
  let remaining=12-state.reads;
  const eligible=new Set(calls.slice(state.processed??0).filter(c=>((!!options.files&&c.name==='computer_files')||isFootageTool(c.name??'')||isHistoryTool(c.name??'')||(!!options.consult&&c.name==='consult_director')||['get_project','search_project','read_project_chunk'].includes(c.name??''))).slice(0,Math.max(0,remaining)));
  state.results??=[];for(let n=state.processed??0;n<calls.length;n++){const call=calls[n];let result:any;try{
   signal?.throwIfAborted();let value:unknown;
   if(options.handoff&&call.name==='request_execution'){if(calls.length!==1)throw new Error('Request execution after consuming pending reads.');value={kind:'execute',instruction:z.string().min(1).max(12000).parse((call.input as any).instruction)};state.value=value;state.done=true;}
   else if(finish&&call.name===finish.name){if(calls.length!==1)throw new Error('Consume the requested reads and director guidance before submitting a final plan or answer.');value=finish.parse(call.input);state.value=value;state.done=true;}
   else if(eligible.has(call)){const context=new ProjectContext(db),input=call.input as any;if(call.name==='computer_files'&&options.files)value=await computerFiles(db,options.files,ComputerReadSchema.parse(input),call.id!,signal);else if(call.name==='consult_director'&&options.consult)value=await options.consult(z.string().min(1).max(12000).parse(input.question),input.attempts,call.id!);else if(call.name==='get_project')value=context.page(input??{});else if(call.name==='search_project'){const args=z.object({query:z.string().min(1).max(1000),limit:z.number().int().min(1).max(12).default(6)}).parse(input);value=context.search(args.query,args.limit,input);}else if(call.name==='read_project_chunk')value=context.read(z.string().parse(input.id),input.expectedRevision,input.startLine,input.endLine);else value=isHistoryTool(call.name!)?executeHistoryTool(db,turnId,call.name!,input):await executeFootageTool(db,call.name!,input,signal);state.reads++;}
   else throw new Error('This tool is unavailable or the local read budget has been reached.');
   result={type:'tool_result',tool_use_id:call.id,content:isFootageTool(call.name??'')?footageResultContent(call.name!,value):JSON.stringify(value)};
  }catch(error){if(error instanceof FileApprovalRequired||error instanceof BlockedEditError||signal?.aborted)throw error;result={type:'tool_result',tool_use_id:call.id,is_error:true,content:(error as Error).message};}state.results.push(boundedToolResult(db,turnId,call,result));state.processed=n+1;save();}
  signal?.throwIfAborted();state.messages.push({role:'user',content:state.results});state.pending=null;state.results=[];state.processed=0;const view=compactConversation(db,turnId,state.messages,384000,true);if(view.length<state.messages.length){state.journalEpoch=(state.journalEpoch??0)+1;state.messages=view;}save();
 }
 if(!state.done)throw new Error('The planning read limit was reached. Narrow the brief or select the relevant footage.');
 return{text:state.text??'',value:state.value};
}
