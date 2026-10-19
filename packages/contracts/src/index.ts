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
/** What a new user tells Gumbo when it first opens (the onboarding): what to call them, what they make, how much they have
 * edited, and how they found Gumbo. The gateway's profiles.ts keeps the same ids. */
export const ONBOARDING={
 makes:['youtube','shorts','podcasts','vlogs','gaming','business','tutorials','personal','other'],
 experience:['new','some','pro'],
 heard:['youtube','tiktok','x','reddit','friend','search','other']
} as const;
export const OnboardingAnswersSchema=z.object({name:z.string().max(80).default(''),makes:z.array(z.enum(ONBOARDING.makes)).max(ONBOARDING.makes.length).default([]),experience:z.enum(ONBOARDING.experience).optional(),heard:z.enum(ONBOARDING.heard).optional()});
export type OnboardingAnswers=z.infer<typeof OnboardingAnswersSchema>;
export const CommandSchema=z.discriminatedUnion('type',[
 z.object({type:z.literal('state')}),z.object({type:z.literal('turn_log'),turnId:z.string().max(200)}),z.object({type:z.literal('turn_feedback'),turnId:z.string().min(1).max(200),rating:z.enum(['up','down']).nullable()}),z.object({type:z.literal('turn_usage'),turnId:z.string().min(1)}),z.object({type:z.literal('turn_changes'),turnId:z.string().min(1)}),z.object({type:z.literal('ai_providers')}),z.object({type:z.literal('activity_page'),turnId:z.string().min(1),before:z.number().int().optional(),limit:z.number().int().min(1).max(500).default(200)}),z.object({type:z.literal('scene_error'),assetId:z.string().max(200).optional(),revisionId:z.string().max(100).optional(),draft:z.string().max(100).optional(),message:z.string().min(1).max(4000),stack:z.string().max(16000).optional()}),z.object({type:z.literal('file_diff'),path:z.string().min(1).max(2000),beforeHash:z.string().max(200).optional(),afterHash:z.string().max(200).optional(),maxChars:z.number().int().min(1000).max(400000).default(120000)}),z.object({type:z.literal('history_page'),kind:z.enum(['messages','versions']),before:z.number().int().optional(),limit:z.number().int().min(1).max(100).default(50)}),z.object({type:z.literal('library_page'),kind:z.enum(['audio','visual']),before:z.number().int().optional(),limit:z.number().int().min(1).max(50).default(20)}),z.object({type:z.literal('create'),folder:z.string(),name:z.string(),initialRequest:InitialRequestSchema.optional()}),z.object({type:z.literal('open'),folder:z.string()}),
 z.object({type:z.literal('import'),paths:z.array(z.string()).min(1),copy:z.boolean().default(false)}),
 z.object({type:z.literal('apply'),snapToSpeech:z.boolean().optional(),ops:z.array(OpSchema),label:z.string(),requestId:z.string(),expectedVersionId:z.string(),turnId:z.string().optional()}),
 z.object({type:z.literal('undo')}),z.object({type:z.literal('redo')}),z.object({type:z.literal('restore'),versionId:z.string()}),z.object({type:z.literal('branch'),versionId:z.string(),name:z.string()}),
 z.object({type:z.literal('rename'),name:z.string().min(1)}),z.object({type:z.literal('message'),text:z.string().min(1),selection:z.array(z.string()).default([]),intent:z.enum(['auto','plan','ask']).optional(),effort:z.enum(['auto','low','medium','high']).optional(),model:z.enum(['auto','sonnet','haiku','opus','gpt-astra','gpt-sol','gpt-luna','gemini-argon','gemini-flash','deepseek-flash']).optional(),assetIds:z.array(z.string()).default([]),requestId:z.string().optional()}),
 z.object({type:z.literal('approve_plan'),plan:TaskPlanSchema,expectedVersionId:z.string(),expectedPlanRevision:z.number().int().nonnegative().optional(),requestId:z.string().min(1),effort:z.enum(['auto','low','medium','high']).optional(),model:z.enum(['auto','sonnet','haiku','opus','gpt-astra','gpt-sol','gpt-luna','gemini-argon','gemini-flash','deepseek-flash']).optional()}),
 z.object({type:z.literal('save_plan_draft'),document:z.string().min(1).max(200000),expectedRevision:z.number().int().nonnegative(),expectedVersionId:z.string()}),
 z.object({type:z.literal('approve'),outline:OutlineSchema,expectedVersionId:z.string(),requestId:z.string().min(1)}),z.object({type:z.literal('cancel')}),z.object({type:z.literal('resume'),text:z.string().trim().min(1).max(12000).optional()}),z.object({type:z.literal('search'),query:z.string()}),
 ...GenerationSchema.options,VisualCommandSchema,
 z.object({type:z.literal('visual_list')}),z.object({type:z.literal('visual_get'),revisionId:z.string()}),z.object({type:z.literal('visual_cancel'),requestId:z.string()}),z.object({type:z.literal('visual_resume'),requestId:z.string()}),
 z.object({type:z.literal('library_list')}),z.object({type:z.literal('library_get'),revisionId:z.string()}),
 z.object({type:z.literal('generation_cancel'),requestId:z.string()}),z.object({type:z.literal('generation_resume'),requestId:z.string()}),
 z.object({type:z.literal('relink'),assetId:z.string(),path:z.string()}),z.object({type:z.literal('collect'),folder:z.string()}),
 z.object({type:z.literal('retry'),assetId:z.string(),step:z.enum(['analysis','proxy','thumbnail','playback_audio','waveform','transcription','audio_features','loudness']).optional()}),z.object({type:z.literal('account'),action:z.enum(['get','signin','signout','usage','browser','billing','checkout','portal','activity','report','profile']),email:z.string().max(320).optional(),password:z.string().optional(),plan:z.enum(['pro','max','max20']).optional(),packs:z.number().int().min(1).max(10).optional(),flow:z.enum(['cancel']).optional(),turnId:z.string().max(200).optional(),note:z.string().max(2000).optional(),kind:z.enum(['report','feedback','training']).optional(),rating:z.enum(['up','down']).optional(),profile:OnboardingAnswersSchema.optional()}),
 z.object({type:z.literal('config'),supabaseUrl:z.string().url(),anonKey:z.string()}),
 z.object({type:z.literal('models'),action:z.enum(['install','cancel']),id:z.string()})
]);
export type Command=z.input<typeof CommandSchema>;
/** The app's own settings (Settings), kept on this computer: the creator's profile, which every request's agent reads, and
 * the providers the user switched off, whose models neither Auto nor the model menu offers. Claude cannot be switched off:
 * it routes every request. */
export const AppSettingsSchema=z.object({
 profile:z.object({name:z.string().max(80).default(''),makes:z.string().max(300).default(''),style:z.string().max(2000).default('')}).default({name:'',makes:'',style:''}),
 disabledProviders:z.array(z.enum(['openai','google','deepseek'])).default([]),
 // Helping improve Gumbo: an edit that goes wrong sends its log by itself (renderer/improve.ts). Unset until asked.
 improve:z.boolean().optional()
});
export type AppSettings=z.infer<typeof AppSettingsSchema>;
/** What Usage shows: spend from the gateway's records, across every computer the account uses. */
/** Credits requests took (one credit is one cent of their AI cost): today, the last 30 days, each of those days, by model. */
export type UsageSummary={todayCredits:number;monthCredits:number;requests:number;days:{date:string;credits:number}[];byModel:{model:string;calls:number;credits:number}[]};
export type PlanId='free'|'pro'|'max'|'max20';
/** Tokens over the last year, for Settings > Profile: by day (UTC), the busiest day, the longest task, the streaks. */
export type TokenActivity={lifetimeTokens:number;peakTokens:number;longestTaskMs:number;longestStreak:number;currentStreak:number;days:{date:string;tokens:number}[]};
/** The plan, the credits left (the plan's for this period, top-ups, less an overdraft) and what can be bought. */
export type BillingSummary={plan:PlanId;planName:string;status:string|null;cancelAtPeriodEnd:boolean;renewsAt:string|null;
 credits:{left:number;plan:number;planTotal:number;topups:number;overdraft:number};plans:{id:PlanId;name:string;priceUsd:number;credits:number}[];
 topup:{credits:number;priceUsd:number;maxPacks:number};payments:boolean;portal:boolean};
export type DesktopEvent={type:string;payload:unknown;seq?:number;projectId?:string;turnId?:string};
/** A new version of the app downloading in the background, or ready to start (Windows; apps/desktop/src/main/updates.ts). */
export type UpdateStatus={status:'idle'|'downloading'|'ready';version?:string};
export type ExportProgress={status:'rendering'|'completed'|'failed'|'cancelled';progress:number;path?:string;paths?:string[];error?:string;phase?:string;warnings?:string[]};
/** automated: a test or script drives this copy (DREAM_HEADLESS), so first-run screens such as the onboarding stay away;
 * onboarding: DREAM_ONBOARDING asks for the onboarding even on a computer that has been through it. */
export type RuntimeStatus={automated?:boolean;onboarding?:boolean;ffmpeg:boolean;ffprobe:boolean;python:boolean;whisper:boolean;models:boolean;platform:string;memoryGb:number;version?:string;projectsFolder?:string;logsFolder?:string};
export interface DreamDesktop {
 setTheme(theme:'light'|'dark',color?:string,choice?:'light'|'dark'|'system'):Promise<void>;
 projects():Promise<ProjectSummary[]>;
 /** Pins, archives, removes from the list, reveals, or deletes (to the Recycle Bin) a project; returns the new list. */ projectAction(id:string,action:import('./files').ProjectAction):Promise<ProjectSummary[]>;
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
 cancelExport():Promise<void>;pickExportFolder(current?:string):Promise<string|null>;beginExport(settings:Record<string,unknown>):Promise<{id:string;video?:{width:number;height:number;fps:number;codec:'h264'|'hevc';quality:'lower'|'recommended'|'higher';container:'mp4'|'mov'}}>;exportChunk(id:string,position:number,data:Uint8Array):Promise<void>;sceneFrame(request:{key:string;source:{url:string}|{html:string};width:number;height:number;frame:number;fps:number;since?:number}):Promise<{width:number;height:number;paint:number;data?:Uint8Array;logs?:string[]}>;closeScenes():Promise<void>;
 /** Puts the app's window in or out of fullscreen (the preview's Fullscreen button). */ setFullScreen(on:boolean):Promise<void>;sceneStill(request:{source:{url:string}|{html:string};width:number;height:number;frame:number;fps:number}):Promise<string>;finishExport(id:string,timing?:Record<string,unknown>):Promise<{path:string;paths:string[]}>;/** Stops an engine export the window could not draw, with the reason. */ failExport(id:string,message:string):Promise<void>;
 reveal(path:string):Promise<void>;
 shareExport():Promise<{url:string;id:string}|null>;
 runtime():Promise<RuntimeStatus>;
 settings():Promise<AppSettings>;
 saveSettings(patch:Partial<AppSettings>):Promise<AppSettings>;
 /** Opens one of the app's own folders (Settings): where projects are saved, or the crash logs. */ openFolder(kind:'projects'|'logs'):Promise<void>;
 catalog():Promise<{scores:Record<string,unknown>[];sfx:Record<string,unknown>[]}>;
 /** Answers a frames.request event: frames the editor's engine drew for the agent, or the error that stopped it. */
 framesResult(id:string,result:unknown):Promise<void>;
 /** The background app update (also sent as app.update events), and restarting into a downloaded one. */
 update():Promise<UpdateStatus>;
 restartToUpdate():Promise<{restarted:boolean;reason?:string}>;
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
