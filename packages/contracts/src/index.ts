import {InitialRequestSchema,type InitialRequest,type ProjectSummary,type FileGrant,type FileRequest,type FileResponse,type FileProposal} from './files';
export * from './files';
import {z} from 'zod';
export * from './review';
export * from './library';
import {VisualCommandSchema} from './visuals';
import {GenerationSchema} from './library';
import {TaskPlanSchema} from './workflow';
import type {ProjectState} from '@dream/project-db';
import {OpSchema} from '@dream/timeline';
export const OutlineSchema=z.object({goal:z.string(),targetDurationSec:z.number().positive(),beats:z.array(z.object({id:z.string(),purpose:z.string(),targetSec:z.number().positive(),sources:z.array(z.object({assetId:z.string(),srcIn:z.number(),srcOut:z.number()}))})).min(1),style:z.string().default('launch')});
export type Outline=z.infer<typeof OutlineSchema>;
export const CommandSchema=z.discriminatedUnion('type',[
 z.object({type:z.literal('state')}),z.object({type:z.literal('turn_usage'),turnId:z.string().min(1)}),z.object({type:z.literal('activity_page'),turnId:z.string().min(1),before:z.number().int().optional(),limit:z.number().int().min(1).max(500).default(200)}),z.object({type:z.literal('scene_error'),assetId:z.string().max(200).optional(),revisionId:z.string().max(100).optional(),draft:z.string().max(100).optional(),message:z.string().min(1).max(4000),stack:z.string().max(16000).optional()}),z.object({type:z.literal('file_diff'),path:z.string().min(1).max(2000),beforeHash:z.string().max(200).optional(),afterHash:z.string().max(200).optional(),maxChars:z.number().int().min(1000).max(400000).default(120000)}),z.object({type:z.literal('history_page'),kind:z.enum(['messages','versions']),before:z.number().int().optional(),limit:z.number().int().min(1).max(100).default(50)}),z.object({type:z.literal('library_page'),kind:z.enum(['audio','visual']),before:z.number().int().optional(),limit:z.number().int().min(1).max(50).default(20)}),z.object({type:z.literal('create'),folder:z.string(),name:z.string(),initialRequest:InitialRequestSchema.optional()}),z.object({type:z.literal('open'),folder:z.string()}),
 z.object({type:z.literal('import'),paths:z.array(z.string()).min(1),copy:z.boolean().default(false)}),
 z.object({type:z.literal('apply'),snapToSpeech:z.boolean().optional(),ops:z.array(OpSchema),label:z.string(),requestId:z.string(),expectedVersionId:z.string(),turnId:z.string().optional()}),
 z.object({type:z.literal('undo')}),z.object({type:z.literal('redo')}),z.object({type:z.literal('restore'),versionId:z.string()}),z.object({type:z.literal('branch'),versionId:z.string(),name:z.string()}),
 z.object({type:z.literal('rename'),name:z.string().min(1)}),z.object({type:z.literal('message'),text:z.string().min(1),selection:z.array(z.string()).default([]),intent:z.enum(['auto','plan','ask']).optional(),effort:z.enum(['auto','low','medium','high']).optional(),model:z.enum(['sonnet','haiku','opus']).optional(),assetIds:z.array(z.string()).default([]),requestId:z.string().optional()}),
 z.object({type:z.literal('approve_plan'),plan:TaskPlanSchema,expectedVersionId:z.string(),expectedPlanRevision:z.number().int().nonnegative().optional(),requestId:z.string().min(1),effort:z.enum(['auto','low','medium','high']).optional(),model:z.enum(['sonnet','haiku','opus']).optional()}),
 z.object({type:z.literal('save_plan_draft'),document:z.string().min(1).max(200000),expectedRevision:z.number().int().nonnegative(),expectedVersionId:z.string()}),
 z.object({type:z.literal('approve'),outline:OutlineSchema,expectedVersionId:z.string(),requestId:z.string().min(1)}),z.object({type:z.literal('cancel')}),z.object({type:z.literal('resume'),text:z.string().trim().min(1).max(12000).optional()}),z.object({type:z.literal('search'),query:z.string()}),
 ...GenerationSchema.options,VisualCommandSchema,
 z.object({type:z.literal('visual_list')}),z.object({type:z.literal('visual_get'),revisionId:z.string()}),z.object({type:z.literal('visual_cancel'),requestId:z.string()}),z.object({type:z.literal('visual_resume'),requestId:z.string()}),
 z.object({type:z.literal('library_list')}),z.object({type:z.literal('library_get'),revisionId:z.string()}),
 z.object({type:z.literal('generation_cancel'),requestId:z.string()}),z.object({type:z.literal('generation_resume'),requestId:z.string()}),
 z.object({type:z.literal('relink'),assetId:z.string(),path:z.string()}),z.object({type:z.literal('collect'),folder:z.string()}),
 z.object({type:z.literal('retry'),assetId:z.string(),step:z.enum(['analysis','proxy','thumbnail','playback_audio','waveform','transcription','audio_features','loudness']).optional()}),z.object({type:z.literal('account'),action:z.enum(['get','signin','signout']),email:z.string().optional(),password:z.string().optional()}),
 z.object({type:z.literal('config'),supabaseUrl:z.string().url(),anonKey:z.string()}),
 z.object({type:z.literal('models'),action:z.enum(['install','cancel']),id:z.string()}),
 z.object({type:z.literal('login_browser')})
]);
export type Command=z.input<typeof CommandSchema>;
export type DesktopEvent={type:string;payload:unknown;seq?:number;projectId?:string;turnId?:string};
export type ExportProgress={status:'rendering'|'completed'|'failed'|'cancelled';progress:number;path?:string;paths?:string[];error?:string;phase?:string;warnings?:string[]};
export type RuntimeStatus={ffmpeg:boolean;ffprobe:boolean;python:boolean;whisper:boolean;models:boolean;platform:string;memoryGb:number};
export interface DreamDesktop {
 setTheme(theme:'light'|'dark'):Promise<void>;
 projects():Promise<ProjectSummary[]>;
 createProject(request:InitialRequest):Promise<ProjectState>;
 fileGrants():Promise<FileGrant[]>;
 grantComputer():Promise<FileGrant>;
 revokeFileGrant(id:string):Promise<void>;
 cancelFiles(requestId:string):Promise<void>;
 files(request:FileRequest):Promise<FileResponse>;
 decideFileChange(id:string,approve:boolean):Promise<FileProposal>;
 registerDropped(files:File[]):Promise<string[]>;
 command<T=ProjectState>(command:Command):Promise<T>;
 pickProject(create?:boolean):Promise<string|null>;
 pickMedia():Promise<string[]>;
 mediaPath(file:File):string;
 exportVideo(request?:'video'|'timeline'|Record<string,unknown>):Promise<{path:string;format?:'video'|'timeline'}|null>;
 cancelExport():Promise<void>;pickExportFolder(current?:string):Promise<string|null>;beginExport(settings:Record<string,unknown>):Promise<{id:string;video?:{width:number;height:number;fps:number;codec:'h264'|'hevc';quality:'lower'|'recommended'|'higher';container:'mp4'|'mov'}}>;exportChunk(id:string,position:number,data:Uint8Array):Promise<void>;sceneFrame(request:{key:string;source:{url:string}|{html:string};width:number;height:number;frame:number;fps:number}):Promise<{width:number;height:number;data:Uint8Array}>;closeScenes():Promise<void>;finishExport(id:string):Promise<{path:string;paths:string[]}>;
 reveal(path:string):Promise<void>;
 shareExport():Promise<{url:string;id:string}|null>;
 runtime():Promise<RuntimeStatus>;
 catalog():Promise<{scores:Record<string,unknown>[];sfx:Record<string,unknown>[]}>;
 onEvent(handler:(event:DesktopEvent)=>void):()=>void;
}
declare global {interface Window {dream:DreamDesktop;}}

export * from './visuals';
export * from './editing-engine';
export * from './workflow';
export * from './outcomes';
export * from './connection';

export * from './intelligence';

export * from './plan-document';
export * from './workspace';
