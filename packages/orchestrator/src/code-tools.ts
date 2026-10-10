import {z} from 'zod';
import {normalizeOptionalNulls} from './provider-input';
import {TaskUpdateSchema,TaskPlanSchema,FileOperationSchema} from '@dream/contracts';
import {DecisionInput} from './project-memory';
import {engineBudgets} from '@dream/config';
const path=z.string().min(1).max(2000);
const WorkerTask=z.object({id:z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/),title:z.string().trim().min(1).max(120),brief:z.string().min(1).max(16000),mode:z.enum(['build','research']).default('build'),writes:z.array(z.string().min(1).max(300)).max(20).default([]),publish:z.boolean().default(false)});
export const codeSchemas={
 remember_decision:DecisionInput,
 consult_director:z.object({question:z.string().min(1).max(12000)}),
 switch_to_orchestrated:z.object({reason:z.string().min(1).max(1000),handoff:z.string().min(1).max(12000)}),
 hand_off:z.object({brief:z.string().min(1).max(12000)}),
 delegate:z.object({tasks:z.array(WorkerTask).min(1).max(engineBudgets.maxWorkers)}),
 set_project_title:z.object({title:z.string().trim().min(1).max(80)}),
 list_files:z.object({path:z.string().default('.'),scope:z.enum(['workspace','computer']).default('workspace'),offset:z.number().int().nonnegative().default(0),cursor:z.string().optional()}),
 search:z.object({query:z.string().min(1).max(500),scope:z.enum(['project','computer']).default('project'),path:z.string().optional(),cursor:z.string().optional()}),
 read_file:z.object({path,scope:z.enum(['workspace','computer','log','receipt','project']).default('workspace'),startLine:z.number().int().positive().default(1),limit:z.number().int().min(1).max(400).default(200)}),
 write_file:z.object({path,content:z.string().max(500000),expectedHash:z.string().optional()}),
 edit_file:z.object({path,oldText:z.string().min(1).max(100000),newText:z.string().max(100000),expectedHash:z.string().optional()}),
 run_command:z.object({command:z.string().min(1).max(32000),cwd:z.string().default('.'),timeoutMs:z.number().int().min(1000).max(3600000).default(600000)}),
 bundle_scene:z.object({entry:path,output:path}),
 read_transcript:z.object({assetId:z.string().min(1),offset:z.number().int().nonnegative().default(0),limit:z.number().int().min(1).max(500).default(300)}),
 publish_project:z.object({}),
 propose_file_changes:z.object({title:z.string().trim().min(1).max(200),operations:z.array(FileOperationSchema).min(1).max(100)}),
 view_media:z.object({target:z.enum(['source','preview']).default('source'),scope:z.enum(['workspace','computer']).default('workspace'),assetId:z.string().optional(),path:z.string().optional(),startSec:z.number().nonnegative().default(0),endSec:z.number().positive().optional(),motion:z.boolean().default(false),audio:z.boolean().default(false)}),
 update_tasks:TaskUpdateSchema,
 finish:z.object({status:z.enum(['complete','blocked']),summary:z.string().min(1).max(4000),evidence:z.array(z.object({toolCallId:z.string(),finding:z.string().min(1).max(2000)})).max(40).default([]),nextAction:z.string().optional(),plan:TaskPlanSchema.optional()})
};
export type ToolName=keyof typeof codeSchemas;
/** solo: Haiku completing a request alone. lead: Opus orchestrating workers without doing any work itself. worker: Haiku executing one assigned build or research task. readonly: replies and plans. */
export type AgentRole='solo'|'lead'|'worker'|'readonly';
const descriptions:Record<ToolName,string>={remember_decision:'Save a lasting editing preference explicitly stated by the user. sourceId must identify their actual message and text must quote their instruction verbatim. Never store assumptions, assistant suggestions or media contents as user preferences. Use supersedes for an earlier decision in the same scope.',consult_director:'Ask Opus one focused creative or technical question. Opus answers from your question and the project overview without inspecting anything, so include the decision, alternatives and the facts it needs. You continue executing.',switch_to_orchestrated:'Switch the rest of this request to director mode: Opus plans it and dispatches workers. Use it when the request turns out to need multi-part creative direction, or when a real attempt keeps failing. The handoff is all the director will know about your progress: what you did, what you learned (exact facts, asset IDs, times), what is published and what remains.',hand_off:'Hand the rest of this request to the editor working alone and end your involvement. Use it when what remains is a simple, exact change that needs no further direction. The brief must be self-contained: what is done, what is published, and exactly what remains.',delegate:`Dispatch Haiku workers and wait for their reports. mode research: a read-only worker that inspects project files, context documents, transcripts, source frames or approved computer folders and reports findings; give it the exact questions to answer and the facts to return. mode build (default): a worker that writes files, runs commands and publishes; its brief must be complete and self-contained: the goal, exact files to create or change, timeline placement (asset IDs, times), visual/audio specifics, and how to verify. Workers cannot see this conversation. Up to ${engineBudgets.maxWorkers} tasks run in parallel. Research tasks never write, so they can run beside anything. Parallel build tasks must list disjoint writes (path prefixes such as src/intro/) and may not edit project.json or publish. Give a single build task publish:true to edit project.json and publish the live preview; run that integration task after parallel work completes. A build task delegated as the only build task may also propose computer file changes for the user to approve. Reports include each worker's summary, changed files and any publication receipt.`,set_project_title:'Give this project a short descriptive title, not a copy of the prompt. Existing user-chosen titles are preserved.',list_files:'Browse the project workspace or approved computer folders. Computer scope uses the existing file grant; follow cursors.',search:'Search authored code, transcript records, project decisions and history, or approved computer files. A workspace-relative path searches that file or directory contents, including context documents; computer paths are absolute. Read selected results before using them.',read_file:'Read bounded file lines with a content hash. scope log reads archived command logs by process ID. Computer files use the existing file permission.',write_file:'Write a complete authored workspace file. Prefer several focused files over one very large file. expectedHash optionally protects an existing revision. Edit project.json to change the timeline and declare generated outputs.',edit_file:'Replace exactly one matching text span in a workspace file. The match must be unique; expectedHash is optional extra protection.',bundle_scene:'Bundle browser JavaScript/TypeScript and installed libraries into a self-contained IIFE under output/. Reference it from the scene with <script src="../output/name.js"></script>; publication inlines local scripts automatically. Does not render or execute the scene.',read_transcript:'Read current timed words from Dream cloud transcription. Waits for in-progress transcription and retries an interrupted job; uses the already imported asset. Never copy from Downloads or install transcription software. Follow nextOffset for long transcripts.',publish_project:'Validate and atomically publish project.json and scene source to the live preview immediately. No execution or rendering required. Returns the new version and the refreshed project.json hash.',run_command:'Execute a Windows command in the isolated project environment for dependencies, code checks and generated static assets. Never render frame sequences or encode video in chat. Commands do not publish; call publish_project afterwards. stdout/stderr and receipts are retained.',view_media:'Inspect timestamped source or generated frames, transcript coverage and audio measurements. target preview returns the published timeline metadata without rendering; nothing renders until Export. motion requests denser samples; set audio true for video audio measurements. Imported footage reuses its existing frame cache. Audio measurements are not proof of listening.',propose_file_changes:'Propose changes to files on the user computer: write a text file, create a folder, copy, move, move to Trash, or export the current video (render_video with the destination path, projectId and the current versionId from the project overview). The user reviews the exact changes; the request pauses until they decide. A declined proposal is not repeated unless the user asks again. Find and read computer files first with list_files, search and read_file (scope computer).',update_tasks:'Update the separate task drawer with current steps and evidence.',finish:'Finish the request: complete once the current revision is published (or nothing needed to change), or blocked with a concrete reason and nextAction. In explicit planning mode supply the editable plan here.'};
const writeTools=new Set<ToolName>(['write_file','edit_file','run_command','bundle_scene','publish_project']);
const modeTools=new Set<ToolName>(['switch_to_orchestrated','hand_off']);
const sideEffects=new Set<ToolName>([...writeTools,...modeTools,'remember_decision','set_project_title','update_tasks','propose_file_changes']);
const readTools:ToolName[]=['list_files','search','read_file','view_media','read_transcript'];
// These carry their own user-facing wording; every other tool takes a short progress label.
const unlabeled=new Set<string>(['finish','delegate','hand_off','switch_to_orchestrated']);
export type ToolOptions={canConsult?:boolean;canPublish?:boolean;canSwitch?:boolean;canPropose?:boolean;research?:boolean};
export function allowedTools(role:AgentRole,options:ToolOptions={}):Set<ToolName>{
 const all=Object.keys(codeSchemas) as ToolName[];
 if(role==='readonly')return new Set(all.filter(n=>!sideEffects.has(n)&&n!=='delegate'&&(n!=='consult_director'||options.canConsult)));
 // The lead orchestrates only: it never inspects, writes, runs or publishes anything itself.
 if(role==='lead')return new Set<ToolName>(['delegate','update_tasks','remember_decision','finish',...(options.canSwitch?['hand_off' as const]:[])]);
 if(role==='worker'){
  if(options.research)return new Set<ToolName>([...readTools,'finish']);
  return new Set(all.filter(n=>!['delegate','consult_director','update_tasks','set_project_title','remember_decision',...modeTools].includes(n)&&(n!=='publish_project'||options.canPublish)&&(n!=='propose_file_changes'||options.canPropose)));
 }
 return new Set(all.filter(n=>n!=='delegate'&&n!=='hand_off'&&(n!=='consult_director'||options.canConsult)&&(n!=='switch_to_orchestrated'||options.canSwitch)));
}
export function toolsFor(role:AgentRole,options:ToolOptions={}){
 const allowed=allowedTools(role,options);
 return(Object.entries(codeSchemas) as [ToolName,z.ZodTypeAny][]).filter(([name])=>allowed.has(name)).map(([name,schema])=>({name,description:descriptions[name],input_schema:(()=>{const json=z.toJSONSchema(schema,{target:'draft-7',io:'input'}) as any;if(!unlabeled.has(name))json.properties={...json.properties,progress:{type:'string',maxLength:200,description:'A specific user-visible editing action based on this step, without implementation filenames or coding terms. Example: Match the caption timing to the first voiceover line.'}};return json;})()}));
}
export function codeTools(readOnly=false,canConsult=false){return toolsFor(readOnly?'readonly':'solo',{canConsult});}
export function parseCodeTool(name:string,input:unknown,readOnly=false,allowed?:Set<string>){
 if(!(name in codeSchemas)||(allowed?!allowed.has(name):readOnly&&(sideEffects.has(name as ToolName)||name==='delegate')))throw new Error('This capability is unavailable in the current phase.');
 const schema=codeSchemas[name as ToolName];const parsed=schema.parse(normalizeOptionalNulls(input,z.toJSONSchema(schema,{target:'draft-7',io:'input'})));
 const progress=!unlabeled.has(name)&&input&&typeof input==='object'?(input as any).progress:undefined;return progress==null?parsed:{...parsed,progress:z.string().trim().min(1).max(200).parse(progress)};
}
/** Parallel build workers must not share write scopes, edit the timeline document or publish. Research workers never write. */
export function validateDelegation(tasks:z.input<typeof WorkerTask>[]){
 const ids=new Set(tasks.map(t=>t.id));if(ids.size!==tasks.length)throw new Error('Worker task IDs must be unique.');
 for(const t of tasks)if(t.mode==='research'&&t.publish)throw new Error(`Task ${t.id}: research tasks are read-only and cannot publish.`);
 const builds=tasks.filter(t=>t.mode!=='research');
 if(builds.length<=1)return;
 const scopes=builds.flatMap(t=>{if(t.publish)throw new Error(`Task ${t.id}: only a single delegated task may publish. Run integration after the parallel tasks.`);if(!t.writes?.length)throw new Error(`Task ${t.id}: parallel tasks must declare writes.`);return t.writes.map(w=>({task:t.id,path:normalizeScope(w)}));});
 for(const scope of scopes)if(scope.path==='project.json'||scope.path===''||scope.path==='.')throw new Error(`Task ${scope.task}: parallel tasks cannot write project.json or the whole workspace.`);
 for(const a of scopes)for(const b of scopes)if(a.task!==b.task&&(a.path===b.path||a.path.startsWith(b.path.endsWith('/')?b.path:b.path+'/')))throw new Error(`Tasks ${a.task} and ${b.task} have overlapping writes (${a.path}, ${b.path}).`);
}
export const normalizeScope=(path:string)=>path.replaceAll('\\','/').replace(/^\.\//,'').replace(/\/+$/,'');
export function withinScopes(path:string,scopes:string[]){const target=normalizeScope(path);return scopes.some(scope=>{const s=normalizeScope(scope);return target===s||target.startsWith(s+'/');});}
