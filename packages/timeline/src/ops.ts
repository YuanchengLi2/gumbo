import { z } from 'zod';
import {patchSchema} from './patch-schema';
import {AnchorSchema,AudioSchema,CaptionSchema,ClipSchema,FramingSchema,ItemSchema,MusicSchema,SettingsSchema,TransitionSchema} from './schema';
const reason={reason:z.string().min(1)};
const at=z.union([z.number().int().nonnegative(),z.object({after:z.string()})]);
export const OpSchema=z.discriminatedUnion('type',[
 z.object({type:z.literal('insert_clip'),clip:ClipSchema,position:at,...reason}),
 z.object({type:z.literal('trim_clip'),clipId:z.string(),srcIn:z.number().optional(),srcOut:z.number().optional(),inWord:z.string().optional(),outWord:z.string().optional(),...reason}),
 z.object({type:z.literal('split_clip'),clipId:z.string(),atSec:z.number().optional(),wordId:z.string().optional(),newClipId:z.string(),...reason}),
 z.object({type:z.literal('move_clip'),clipId:z.string(),position:at,...reason}),
 z.object({type:z.literal('delete_clips'),clipIds:z.array(z.string()),...reason}),
 z.object({type:z.literal('replace_clip_source'),clipId:z.string(),assetId:z.string(),srcIn:z.number(),srcOut:z.number(),wordMap:z.record(z.string(),z.string()).optional(),...reason}),
 z.object({type:z.literal('set_clip_hold'),clipId:z.string(),holdSec:z.number().positive(),...reason}),
 z.object({type:z.literal('set_track_settings'),trackId:z.string(),settings:z.object({name:z.string().max(80).optional(),muted:z.boolean().optional(),hidden:z.boolean().optional(),locked:z.boolean().optional()}),...reason}),
 z.object({type:z.literal('set_speed'),clipId:z.string(),speed:z.number().min(.25).max(4),...reason}),
 z.object({type:z.literal('set_framing'),clipId:z.string(),framing:FramingSchema,...reason}),
 z.object({type:z.literal('set_clip_audio'),clipId:z.string(),audio:patchSchema(AudioSchema),...reason}),
 z.object({type:z.literal('set_transition'),clipId:z.string(),transition:TransitionSchema.nullable(),...reason}),
 z.object({type:z.literal('add_item'),item:ItemSchema,...reason}),
 z.object({type:z.literal('update_item'),itemId:z.string(),clearEnd:z.boolean().optional(),changes:patchSchema(ItemSchema.omit({id:true})),...reason}),
 z.object({type:z.literal('remove_item'),itemId:z.string(),...reason}),
 z.object({type:z.literal('set_captions'),captions:CaptionSchema.nullable(),...reason}),
 z.object({type:z.literal('update_caption_overrides'),overrides:CaptionSchema.shape.overrides,...reason}),
 z.object({type:z.literal('add_music'),music:MusicSchema,...reason}),
 z.object({type:z.literal('update_music'),musicId:z.string(),changes:patchSchema(MusicSchema.omit({id:true})),...reason}),
 z.object({type:z.literal('remove_music'),musicId:z.string(),...reason}),
 z.object({type:z.literal('set_project_settings'),settings:patchSchema(SettingsSchema),...reason}),
 z.object({type:z.literal('set_story_beats'),beats:z.array(z.object({id:z.string(),purpose:z.string(),targetSec:z.number().positive().optional()})),...reason})
]);
export type Op=z.infer<typeof OpSchema>;
/** The same operations as agent actions: a reason is optional there, because the step's progress label already explains it. */
export const ActionSchema=z.discriminatedUnion('type',OpSchema.options.map(option=>option.extend({reason:z.string().max(300).optional()})) as unknown as [typeof OpSchema.options[number],...typeof OpSchema.options[number][]]);
export type Action=z.input<typeof ActionSchema>;
export const BatchSchema=z.object({requestId:z.string(),expectedVersionId:z.string(),turnId:z.string().optional(),label:z.string().min(1),ops:z.array(OpSchema).min(1).max(50)});
