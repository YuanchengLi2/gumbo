import {z} from 'zod';

export type FileGrant={id:string;scope:'computer'|'path'|'project';path?:string;write:boolean;createdAt:string;revokedAt?:string};
export type FileEntry={name:string;path:string;directory:boolean;size:number;modifiedAt:string};
export type FilePage={entries:FileEntry[];nextCursor?:string;roots?:string[];locations?:{name:string;path:string}[];scanned?:number};
export const FileOperationSchema=z.discriminatedUnion('kind',[
 z.object({kind:z.literal('render_video'),path:z.string().min(1),projectId:z.string(),versionId:z.string()}),
 z.object({kind:z.literal('mkdir'),path:z.string().min(1)}),
 z.object({kind:z.literal('write'),path:z.string().min(1),text:z.string().max(2_000_000)}),
 z.object({kind:z.literal('copy'),path:z.string().min(1),destination:z.string().min(1)}),
 z.object({kind:z.literal('move'),path:z.string().min(1),destination:z.string().min(1)}),
 z.object({kind:z.literal('trash'),path:z.string().min(1)})
]);
export type FileOperation=z.infer<typeof FileOperationSchema>;
export type FileChange={operation:FileOperation;before?:string;exists:boolean;fingerprint:string;destinationFingerprint?:string};
export type FileProposal={id:string;projectId?:string;turnId?:string;title:string;inputHash?:string;changes:FileChange[];status:'pending'|'approved'|'running'|'complete'|'denied'|'failed';completed:number;error?:string;createdAt:string};
export const FileRequestSchema=z.discriminatedUnion('action',[
 z.object({action:z.literal('authorize_import'),paths:z.array(z.string()).min(1).max(200)}),
 z.object({action:z.literal('list'),path:z.string().default(''),requestId:z.string().max(100).optional(),cursor:z.string().optional()}),
 z.object({action:z.literal('search'),path:z.string().default(''),query:z.string().min(1).max(200),requestId:z.string().max(100).optional(),cursor:z.string().optional()}),
 z.object({action:z.literal('read'),path:z.string().min(1),offset:z.number().int().nonnegative().default(0)}),
 z.object({action:z.literal('propose'),requestId:z.string().min(1).max(200),title:z.string().max(200),operations:z.array(FileOperationSchema).min(1).max(100)}),
 z.object({action:z.literal('receipt'),id:z.string()})
]);
export type FileRequest=z.infer<typeof FileRequestSchema>;
export type FileResponse=FilePage|FileProposal|{paths:string[]}|{text:string;nextOffset?:number}|{permissionRequired:true};
export type FileService=(request:FileRequest,signal?:AbortSignal)=>Promise<FileResponse>;
export const InitialRequestSchema=z.object({requestId:z.string().min(1).max(100),text:z.string().max(12000),paths:z.array(z.string()).max(200).default([])});
export type InitialRequest=z.infer<typeof InitialRequestSchema>;
export type ProjectSummary={id:string;folder:string;name:string;updatedAt:string;durationSec:number;thumbnail?:string;missing?:boolean};
