import {z} from 'zod';
import {ScoreSchema,SoundDesignSchema} from '@dream/procedural-media';
import {AnchorSchema} from '@dream/timeline';
const request={requestId:z.string().min(1),expectedVersionId:z.string()};
const placement={start:AnchorSchema.optional(),gainDb:z.number().min(-60).max(12).optional()};
export const GenerationSchema=z.discriminatedUnion('type',[
 z.object({type:z.literal('generate_music'),presetId:z.string(),durationSec:z.number().positive().max(600),tempo:z.number().min(40).max(200).optional(),intensity:z.number().min(0).max(1).optional(),instruments:z.array(z.enum(['pad','bass','pluck','lead','keys','drums'])).min(1).optional(),...placement,...request}),
 z.object({type:z.literal('generate_sfx'),presetId:z.string(),...placement,...request}),
 z.object({type:z.literal('create_score'),document:ScoreSchema,...placement,...request}),
 z.object({type:z.literal('create_sfx'),sound:SoundDesignSchema,...placement,...request}),
 z.object({type:z.literal('edit_score'),scoreId:z.string(),revisionId:z.string(),document:ScoreSchema,...request})
]);
export type GenerationCommand=z.infer<typeof GenerationSchema>;
export const LibraryRevisionSchema=z.object({revisionId:z.string(),definitionId:z.string(),kind:z.enum(['score','sfx']),title:z.string(),presetId:z.string().optional(),document:ScoreSchema.optional(),sound:SoundDesignSchema.optional(),assetId:z.string(),stemAssetIds:z.array(z.object({trackId:z.string(),assetId:z.string()})),masterGain:z.number(),beats:z.array(z.number()),rendererVersion:z.string(),createdAt:z.string()});
export type LibraryRevision=z.infer<typeof LibraryRevisionSchema>;
export type GenerationResult={assetId:string;revisionId:string;definitionId:string;placed:boolean;versionId?:string;warning?:string};
