import {stableTools} from './tool-registry';
import {z} from 'zod';
import {OpSchema} from '@dream/timeline';
export const groups={
 files:['computer_files','import_computer_media'],
 footage:['inspect_footage','list_assets','read_footage','search_footage'],
 visual:['create_visual_draft','get_visual_draft','write_visual_module','patch_visual_module','set_visual_parameters','read_visual_module','commit_visual_draft','get_visual_schema','get_visual','list_visuals','create_visual','preview_frames'],
 audio:['get_media_schema','list_sound_catalog','get_score','generate_music','generate_sfx','create_score','create_sfx','edit_score'],
 history:['list_execution_history','read_execution']
} as const;
export type ToolGroup=keyof typeof groups;
export function suggestGroups(text:string):ToolGroup[]{const result:ToolGroup[]=[];if(/\b(files?|folders?|computer|desktop|downloads|documents|pictures|videos|music folder|drive|saved|laptop|onedrive|rename|move|trash|directory)\b/i.test(text))result.push('files');if(/\b(footage|source|speaker|said|says|transcript|b.roll|interview|story|coverage)\b/i.test(text))result.push('footage');if(/\b(visual|animation|animate|motion|graphic|title|logo|overlay|particle|scene|remotion|tsx|design)\b/i.test(text))result.push('visual');if(/\b(music|score|sound|sfx|instrument|compose|bass|drum|melody|chime)\b/i.test(text))result.push('audio');return result;}
const names=new Set(Object.values(groups).flat());
export function selectTools(all:any[],enabled:string[]){return stableTools(all.filter(tool=>!names.has(tool.name)||Object.entries(groups).some(([group,list])=>enabled.includes(group)&&(list as readonly string[]).includes(tool.name))));}
export const loadToolsSchema=z.object({groups:z.array(z.enum(['footage','visual','audio','history','files'])).min(1).max(5)});
export const discoveryTool={name:'load_tools',description:'Load additional capabilities into this same editor: footage (search/read sources), visual (author/revise full React/Remotion scenes and inspect frames), audio (compose/edit scores and SFX), history (read archived execution), files (permission-based local file access and import). All remain available; choose only what the current task needs.',input_schema:z.toJSONSchema(loadToolsSchema,{target:'draft-7'})};
export const operationTool={name:'get_operation_schema',description:'Read exact schemas for only the needed timeline operations. Names: '+OpSchema.options.map(s=>s.shape.type.value).join(', '),input_schema:{type:'object',properties:{types:{type:'array',items:{type:'string'},minItems:1,maxItems:6}},required:['types']}};
export function operationSchemas(input:unknown){const {types}=z.object({types:z.array(z.string()).min(1).max(6)}).parse(input);return types.map(type=>{const schema=OpSchema.options.find(s=>s.shape.type.value===type);if(!schema)throw new Error('Unknown operation: '+type);return z.toJSONSchema(schema,{target:'draft-7'});});}
/** Cheap contracts for common edits. Full schemas remain available by exact operation name. */
export const operationQuickReference=`Every operation includes type and reason. Common shapes: trim_clip {clipId,srcIn?,srcOut?} in source seconds; set_clip_audio {clipId,audio:{gainDb?,mute?,fadeInSec?,fadeOutSec?}}; set_project_settings {settings:{fps?,width?,height?}}; delete_clips {clipIds}; move_clip {clipId,position:number|{after:clipId}}; set_speed {clipId,speed}; split_clip {clipId,atSec,newClipId}. Retrieve exact schemas for other operations or uncertain fields. Operations remain fully validated locally.`;
