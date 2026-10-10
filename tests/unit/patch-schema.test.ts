import {it,expect} from 'vitest';
import {OpSchema} from '@dream/timeline';
import {z} from 'zod';
it('partial editing commands preserve omitted values instead of injecting creation defaults',()=>{
 const commands=[
  {type:'set_project_settings',settings:{width:1080,height:1080},reason:'Change format'},
  {type:'set_clip_audio',clipId:'clip',audio:{gainDb:-6},reason:'Adjust level'},
  {type:'update_music',musicId:'music',changes:{assetId:'revised'},reason:'Use revision'},
  {type:'update_item',itemId:'overlay',changes:{durationSec:2},reason:'Adjust duration'}
 ];
 for(const command of commands)expect(OpSchema.parse(command)).toEqual(command);
 expect(()=>z.toJSONSchema(OpSchema,{target:'draft-7'})).not.toThrow();
});
