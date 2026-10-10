import {z} from 'zod';
import {AnchorSchema} from '@dream/timeline';
import {AssetSchema} from '@dream/footage';

export const VISUAL_RUNTIME_VERSION='dream-visual-2';
export const VisualDefinitionSchema=z.object({
 schemaVersion:z.union([z.literal(1),z.literal(2)]),id:z.string().min(1),title:z.string().min(1).max(120),
 code:z.string().max(250000).default(''),source:z.object({entry:z.string(),modules:z.record(z.string(),z.string().regex(/^[a-f0-9]{64}$/))}).optional(),moduleSources:z.record(z.string(),z.string()).optional(),parameterSchema:z.record(z.string(),z.unknown()),parameters:z.record(z.string(),z.unknown()),
 width:z.number().int().min(1).max(1920),height:z.number().int().min(1).max(1920),fps:z.union([z.literal(24),z.literal(25),z.literal(30),z.literal(60)]),
 durationInFrames:z.number().int().positive().max(3600),seed:z.number().int(),assetIds:z.array(z.string()).max(64).default([]),transparent:z.boolean().default(true)
});
export type VisualDefinition=z.infer<typeof VisualDefinitionSchema>;
export const VisualCommandSchema=z.object({type:z.literal('create_visual'),definition:VisualDefinitionSchema,start:AnchorSchema,placement:z.enum(['overlay','spine']).default('overlay'),replaceItemId:z.string().optional(),requestId:z.string().min(1),expectedVersionId:z.string()});
export type VisualCommand=z.infer<typeof VisualCommandSchema>;
export const VisualDiagnosticSchema=z.object({stage:z.enum(['compile','parameters','runtime','capture']),message:z.string(),frame:z.number().int().nonnegative().optional()});
export const VisualCaptureSchema=z.object({cacheKey:z.string().regex(/^[a-f0-9]{64}$/).optional(),revisionId:z.string().regex(/^[a-f0-9]{64}$/),runtimeVersion:z.string(),width:z.number().int().positive(),height:z.number().int().positive(),fps:z.number().positive(),durationInFrames:z.number().int().positive(),frames:z.array(z.object({frame:z.number().int().nonnegative(),sha256:z.string().regex(/^[a-f0-9]{64}$/)})),stills:z.array(z.object({frame:z.number().int().nonnegative(),base64:z.string(),mimeType:z.literal('image/png')})).length(4)});
export type VisualCapture=z.infer<typeof VisualCaptureSchema>;
export const VisualRenderRequestSchema=z.object({definition:VisualDefinitionSchema,assets:z.array(AssetSchema)});
export const VisualRenderResultSchema=z.object({manifest:VisualCaptureSchema,directory:z.string().min(1),cacheHit:z.boolean()});
export const VisualProgressSchema=z.object({phase:z.enum(['validating','rendering']),done:z.number().int().nonnegative(),total:z.number().int().positive()}).refine(p=>p.done<=p.total);
export type VisualRenderer=(request:z.infer<typeof VisualRenderRequestSchema>,signal:AbortSignal,progress?:(value:z.infer<typeof VisualProgressSchema>)=>void)=>Promise<z.infer<typeof VisualRenderResultSchema>>;
export const VisualRevisionSchema=z.object({revisionId:z.string(),definition:VisualDefinitionSchema,assetId:z.string(),createdAt:z.string()});
export type VisualRevision=z.infer<typeof VisualRevisionSchema>;
export type VisualResult={assetId:string;revisionId:string;placed:boolean;versionId?:string;itemId?:string;warning?:string;stills:VisualCapture['stills']};
