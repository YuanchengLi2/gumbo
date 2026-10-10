import {z} from 'zod';
export const AIConnectionSchema=z.object({url:z.string().url(),token:z.string().max(32768),accountId:z.string().optional()});
export type AIConnection=z.infer<typeof AIConnectionSchema>;
