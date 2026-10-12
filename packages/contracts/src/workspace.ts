import {z} from 'zod';
import {TimelineSchema} from '@dream/timeline';

// props: values passed to the scene component (one component can serve many shots); assets: project asset IDs the
// scene shows; transparent: the scene has no background, for overlays; music: music output IDs whose beats the scene
// reads with useBeats. kind music is a score file (src/music/*.score.json); kind sfx is a sound design file or preset:<name>.
export const WorkspaceOutputSchema=z.object({id:z.string().regex(/^[a-zA-Z0-9_-]+$/),path:z.string().min(1),kind:z.enum(['scene','image','audio','video','music','sfx']),fps:z.number().positive().optional(),width:z.number().int().positive().max(7680).optional(),height:z.number().int().positive().max(7680).optional(),durationInFrames:z.number().int().positive().optional(),props:z.record(z.string(),z.unknown()).optional(),assets:z.array(z.string()).max(200).optional(),transparent:z.boolean().optional(),music:z.array(z.string()).max(8).optional()});
export const WorkspaceDocumentSchema=z.object({format:z.literal('dream-workspace'),version:z.literal(1),baseVersionId:z.string().min(1),timeline:TimelineSchema,outputs:z.array(WorkspaceOutputSchema).default([])});
export type WorkspaceDocument=z.infer<typeof WorkspaceDocumentSchema>;
/** The agent's unpublished edit, streamed to the editor while it works: the timeline as project.json has it, placeholder
 * assets for outputs that are built only on publish, and what is pending. With error and no timeline, project.json is
 * mid-write or does not resolve; the editor keeps showing the last good draft. */
export type WorkspaceDraft={hash:string;error?:string;basedOn?:string;timeline?:z.infer<typeof TimelineSchema>;assets?:import('@dream/footage').Asset[];pending?:{assetId:string;outputId:string;kind:string;path:string}[]};
export const ProcessRequestSchema=z.object({id:z.string().regex(/^[a-zA-Z0-9_-]+$/),projectId:z.string(),workspace:z.string(),command:z.string().min(1).max(32000),cwd:z.string().default('.'),timeoutMs:z.number().int().min(1000).max(3600000).default(600000)});
export type ProcessRequest=z.infer<typeof ProcessRequestSchema>;
export type ProcessResult={id:string;status:'complete'|'failed'|'cancelled'|'interrupted';exitCode:number|null;startedAt:string;finishedAt:string;output:string;logPath:string;isolation:'windows-appcontainer'|'local';commandHash:string};
/** A command that ran to its end is a result whatever its exit code, as in a terminal: grep finding nothing exits 1.
 * Only a stop, a timeout or a crash is an error. */
export const ranToEnd=(process:{status:string;exitCode?:number|null})=>process.status==='complete'||process.status==='failed'&&typeof process.exitCode==='number'&&process.exitCode>=0;
export type ProcessRunner=(request:ProcessRequest,signal:AbortSignal,onOutput:(text:string)=>void)=>Promise<ProcessResult>;
export type SourceSnapshot={hash:string;files:Record<string,string>};
// Publications record which files changed and by how many lines; the text itself comes from file_diff on demand.
export type SourceChange={path:string;beforeHash?:string;afterHash?:string;added:number;removed:number};
/** Lines added and removed between two texts (multiset comparison, order-insensitive; exact enough for a change summary). */
export function lineDelta(before:string,after:string){const counts=new Map<string,number>();for(const line of before?before.split('\n'):[])counts.set(line,(counts.get(line)??0)+1);let added=0;for(const line of after?after.split('\n'):[]){const n=counts.get(line)??0;if(n)counts.set(line,n-1);else added++;}let removed=0;for(const n of counts.values())removed+=n;return{added,removed};}
export type PublicationReceipt={id:string;versionId:string;baseVersionId:string;sourceSnapshot:string;processId:string;assets:string[];refreshed?:string[];changes:string[];files:SourceChange[];documentHash:string};
/** A worker's write boundary: path prefixes (empty means any authored file) and whether it owns project.json. */
export type WorkerScope={writes:string[];canPublish:boolean;taskId?:string;parent?:string};
export interface CodeWorkspacePort {
 initialize():Promise<void>;
 execute(name:string,input:any,callId:string,turnId:string,signal:AbortSignal,scope?:WorkerScope):Promise<any>;
 unpublishedChanges?():string[];
 /** Errors scenes reported while playing (player or chat preview) for scenes changed in this request and its current drafts. */
 sceneErrors?(turnId?:string):{scene:string;assetId?:string;location?:string;message:string}[];
 /** Fact checks of what this request has published so far (mustFix blocks finishing unless kept with a reason). */
 editChecks?(turnId:string):{mustFix:{id:string;text:string}[];notes:{id:string;text:string}[]}|undefined;
 context(query:string):unknown;
 /** The project as every worker of one task set sees it: overview, media, capabilities and decisions; no query search. */
 snapshot?():unknown;
 /** Workspace files attached to a worker brief, within a total character budget. */
 readContext?(paths:string[],maxCharacters:number):{path:string;text:string;truncated:boolean}[];
 mediaContext?():unknown;
 currentContext?():unknown;
}
