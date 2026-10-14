import {z} from 'zod';
import {TimelineSchema} from '@dream/timeline';
import {FootageSchema} from '@dream/footage';

export const ReviewFrameSchema=z.object({frame:z.number().int().nonnegative(),labels:z.array(z.string().max(200)).max(20)});
export const ReviewRenderRequestSchema=z.object({versionId:z.string().min(1),timeline:TimelineSchema,footage:FootageSchema,frames:z.array(ReviewFrameSchema).min(1).max(16)});
// stats: measured colours of the drawn frame, the average and a 3x3 grid of region averages (top-left to bottom-right).
const colour=z.string().regex(/^#[0-9a-f]{6}$/);
export const ReviewImagesSchema=z.object({versionId:z.string(),frames:z.array(ReviewFrameSchema.extend({mimeType:z.literal('image/jpeg'),data:z.string().min(1).max(700_000),sha256:z.string().regex(/^[a-f0-9]{64}$/),stats:z.object({mean:colour,grid:z.array(colour).length(9)}).optional()})).min(1).max(16)});
export const ReviewReportSchema=z.object({summary:z.string().min(1).max(3000),issues:z.array(z.object({severity:z.enum(['repair','warning']),itemIds:z.array(z.string()).max(20),frame:z.number().int().nonnegative().optional(),problem:z.string().min(1).max(1000),recommendation:z.string().min(1).max(1000)})).max(12)});
export type ReviewRenderRequest=z.infer<typeof ReviewRenderRequestSchema>;
export type ReviewImages=z.infer<typeof ReviewImagesSchema>;
export type ReviewReport=z.infer<typeof ReviewReportSchema>;
export type ReviewRenderer=(request:ReviewRenderRequest,signal:AbortSignal)=>Promise<ReviewImages>;
