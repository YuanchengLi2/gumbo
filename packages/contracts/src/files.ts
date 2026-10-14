import {z} from 'zod';

// folder: a read-only subtree (a folder the user dropped or chose).
export type FileGrant={id:string;scope:'computer'|'path'|'project'|'folder';path?:string;write:boolean;createdAt:string;revokedAt?:string};
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
 z.object({action:z.literal('receipt'),id:z.string()}),
 // Media on the computer in a time window (local time), sorted by capture time; folders default to camera, video, download and desktop folders.
 z.object({action:z.literal('find_media'),when:z.enum(['today','yesterday','this_week','last_7_days']).optional(),from:z.string().max(40).optional(),to:z.string().max(40).optional(),kinds:z.array(z.enum(['video','image','audio'])).max(3).optional(),folders:z.array(z.string().min(1)).max(20).optional(),query:z.string().max(200).optional(),minDurationSec:z.number().nonnegative().optional(),sort:z.enum(['captured','modified','name']).default('captured'),limit:z.number().int().min(1).max(200).default(100),requestId:z.string().max(100).optional()}),
 z.object({action:z.literal('computer_status')})
]);
export type MediaEntry={path:string;name:string;kind:'video'|'image'|'audio';capturedAt?:string;capturedAtSource?:string;modifiedAt:string;sizeMB:number;durationSec?:number;width?:number;height?:number;importedAssetId?:string};
export type MediaCatalog={media:MediaEntry[];scanned:number;matched:number;truncated:boolean;window?:{from:string;to:string};now:string;timeZone:string;folders:{name:string;path:string}[]};
export type ComputerStatus={access:boolean;now:string;timeZone:string;folders?:{name:string;path:string;exists:boolean;removable?:boolean}[];locations?:{name:string;path:string}[]};
export type FileRequest=z.infer<typeof FileRequestSchema>;
export type FileResponse=FilePage|FileProposal|MediaCatalog|ComputerStatus|{paths:string[]}|{text:string;nextOffset?:number}|{permissionRequired:true};
export type FileService=(request:FileRequest,signal?:AbortSignal)=>Promise<FileResponse>;
export const InitialRequestSchema=z.object({requestId:z.string().min(1).max(100),text:z.string().max(12000),paths:z.array(z.string()).max(200).default([]),intent:z.enum(['auto','plan','ask']).optional(),model:z.enum(['auto','sonnet','haiku','opus','gpt-astra','gpt-sol','gpt-luna','gemini-argon','gemini-flash','deepseek-flash']).optional()});
export type InitialRequest=z.infer<typeof InitialRequestSchema>;
export type ProjectSummary={id:string;folder:string;name:string;updatedAt:string;durationSec:number;thumbnail?:string;missing?:boolean};
