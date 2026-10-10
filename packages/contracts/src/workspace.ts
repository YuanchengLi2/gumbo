import {z} from 'zod';
import {TimelineSchema} from '@dream/timeline';

export const WorkspaceOutputSchema=z.object({id:z.string().regex(/^[a-zA-Z0-9_-]+$/),path:z.string().min(1),kind:z.enum(['scene','image','audio']),fps:z.number().positive().optional(),width:z.number().int().positive().max(7680).optional(),height:z.number().int().positive().max(7680).optional(),durationInFrames:z.number().int().positive().optional()});
export const WorkspaceDocumentSchema=z.object({format:z.literal('dream-workspace'),version:z.literal(1),baseVersionId:z.string().min(1),timeline:TimelineSchema,outputs:z.array(WorkspaceOutputSchema).default([])});
export type WorkspaceDocument=z.infer<typeof WorkspaceDocumentSchema>;
export const ProcessRequestSchema=z.object({id:z.string().regex(/^[a-zA-Z0-9_-]+$/),projectId:z.string(),workspace:z.string(),command:z.string().min(1).max(32000),cwd:z.string().default('.'),timeoutMs:z.number().int().min(1000).max(3600000).default(600000)});
export type ProcessRequest=z.infer<typeof ProcessRequestSchema>;
export type ProcessResult={id:string;status:'complete'|'failed'|'cancelled'|'interrupted';exitCode:number|null;startedAt:string;finishedAt:string;output:string;logPath:string;isolation:'windows-appcontainer';commandHash:string};
export type ProcessRunner=(request:ProcessRequest,signal:AbortSignal,onOutput:(text:string)=>void)=>Promise<ProcessResult>;
export type SourceSnapshot={hash:string;files:Record<string,string>};
export type SourceChange={path:string;beforeHash?:string;afterHash?:string;before:string;after:string;truncated:boolean};
export type PublicationReceipt={id:string;versionId:string;baseVersionId:string;sourceSnapshot:string;processId:string;assets:string[];changes:string[];files:SourceChange[];documentHash:string};
/** A worker's write boundary: path prefixes (empty means any authored file) and whether it owns project.json. */
export type WorkerScope={writes:string[];canPublish:boolean;taskId?:string};
export interface CodeWorkspacePort {
 initialize():Promise<void>;
 execute(name:string,input:any,callId:string,turnId:string,signal:AbortSignal,scope?:WorkerScope):Promise<any>;
 unpublishedChanges?():string[];
 context(query:string):unknown;
 mediaContext?():unknown;
 currentContext?():unknown;
}
