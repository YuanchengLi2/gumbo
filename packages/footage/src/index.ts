import { z } from 'zod';
export * from './context';
export const AssetSchema = z.object({
  id: z.string(), filename: z.string(), kind: z.enum(['video','audio','image']),
  durationSec: z.number().nonnegative(), fps: z.number().nonnegative().default(30),
  width: z.number().nonnegative().default(1920), height: z.number().nonnegative().default(1080),
  contentType: z.enum(['talking_head','screen','slides','broll','mixed']).default('mixed'),
  hasAudio: z.boolean().default(false), rotation: z.number().default(0),
  originalPath: z.string(), proxyPath: z.string().optional(), thumbnailPath: z.string().optional(),
  audioPath: z.string().optional(), fingerprint: z.string(), missing: z.boolean().default(false),
  videoCodec:z.string().optional(),audioCodec:z.string().optional(),
  playback:z.object({video:z.enum(['original','proxy']).optional(),audio:z.enum(['original','proxy','normalized','none']).optional(),audioReady:z.boolean().optional(),ready:z.boolean()}).optional(),
  copyRequested:z.boolean().optional(),
  context:z.object({revision:z.string().optional(),coverage:z.string().optional(),status:z.enum(['preparing','ready','failed']),frameCount:z.number().int().nonnegative().optional(),error:z.string().optional()}).optional(),
  waveform: z.array(z.number()).default([]), status: z.enum(['registered','processing','ready','failed']).default('registered'),
  understanding:z.object({status:z.enum(['queued','running','partial','complete','interrupted','waiting_for_account','waiting_for_connection','waiting_for_permission','failed']),observedThroughSec:z.number().nonnegative().default(0),summary:z.string().optional(),error:z.string().optional(),policy:z.string()}).optional(),
  sequence:z.object({directory:z.string(),frameCount:z.number().int().positive(),fps:z.number().positive(),revisionId:z.string().regex(/^[a-f0-9]{64}$/)}).optional(),
  scene:z.object({format:z.literal('html'),revisionId:z.string().regex(/^[a-f0-9]{64}$/),durationInFrames:z.number().int().positive()}).optional(),
  creation:z.object({kind:z.literal('code'),processId:z.string(),outputId:z.string()}).optional(),
  generated:z.object({kind:z.enum(['score','sfx']),definitionId:z.string(),revisionId:z.string(),rendererVersion:z.string(),role:z.enum(['mix','stem']),trackId:z.string().optional()}).optional()
});
export type Asset = z.infer<typeof AssetSchema>;
export const WordSchema = z.object({id:z.string(),assetId:z.string(),text:z.string(),start:z.number().nonnegative(),end:z.number().positive(),confidence:z.number().min(0).max(1),speaker:z.string().default('unknown'),pauseBefore:z.number().nonnegative().default(0)});
export type Word = z.infer<typeof WordSchema>;
export const ShotSchema = z.object({id:z.string(),assetId:z.string(),start:z.number(),end:z.number(),framePaths:z.array(z.string()).default([]),log:z.object({description:z.string(),framing:z.string(),tags:z.array(z.string()),energy:z.enum(['low','medium','high']),usableAsBroll:z.boolean()}).optional()});
export type Shot = z.infer<typeof ShotSchema>;
export const FaceSchema = z.object({id:z.string(),assetId:z.string(),samples:z.array(z.object({t:z.number(),box:z.tuple([z.number(),z.number(),z.number(),z.number()])})),speaker:z.string().optional()});
export type FaceTrack = z.infer<typeof FaceSchema>;
export const FootageSchema = z.object({assets:z.array(AssetSchema),words:z.array(WordSchema),shots:z.array(ShotSchema),faces:z.array(FaceSchema).default([]),revision:z.number().int().default(0)});
export type FootageIndex = z.infer<typeof FootageSchema>;
export const emptyFootage = (): FootageIndex => ({assets:[],words:[],shots:[],faces:[],revision:0});
export function serializeFootage(index:FootageIndex): string {
  return index.assets.map(a => {
    const shots=index.shots.filter(s=>s.assetId===a.id);
    const words=index.words.filter(w=>w.assetId===a.id);
    return `Asset ${a.id}: ${a.filename}, ${a.kind}, ${a.durationSec.toFixed(3)}s, ${a.contentType}\n`+
      shots.map(s=>`[${s.id} ${s.start.toFixed(3)}–${s.end.toFixed(3)}] ${s.log?.description??'Visual description pending'} ${s.log?.tags.join(', ')??''}`).join('\n')+'\n'+
      words.map(w=>`[${w.id} ${w.start.toFixed(3)}–${w.end.toFixed(3)} ${w.speaker}] ${w.text}`).join(' ');
  }).join('\n\n');
}

export * from './understanding';
