import {z} from 'zod';
export const effectDefinitions=[
 {id:'title_card',name:'Title card',category:'graphics'}, {id:'lower_third',name:'Lower third',category:'graphics'}, {id:'callout_arrow',name:'Callout arrow',category:'graphics'}, {id:'circle_highlight',name:'Circle highlight',category:'graphics'}, {id:'counter',name:'Counter',category:'graphics'}, {id:'progress_bar',name:'Progress bar',category:'graphics'},
 {id:'punch_zoom',name:'Punch zoom',category:'motion'}, {id:'slow_push',name:'Slow push',category:'motion'}, {id:'shake',name:'Shake',category:'motion'}, {id:'reframe',name:'Reframe',category:'motion'}, {id:'grade',name:'Color grade',category:'color'},
 {id:'clean',name:'Clean',category:'captions'},{id:'karaoke',name:'Karaoke',category:'captions'},{id:'word_pop',name:'Word pop',category:'captions'},{id:'emphasis',name:'Emphasis',category:'captions'},
 ...['cut','crossfade','dip_to_black','whip','zoom_through','slide'].map(id=>({id,name:id.replaceAll('_',' '),category:'transitions'}))];
export const visualParams=z.object({text:z.string().max(500).default(''),color:z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#ffffff'),background:z.string().default('transparent'),fontSize:z.number().min(10).max(200).default(60),x:z.number().min(0).max(1).default(.5),y:z.number().min(0).max(1).default(.8),amount:z.number().min(0).max(2).default(.1)});
export function validateComponent(id:string,params:unknown){if(!effectDefinitions.some(e=>e.id===id))throw new Error(`Unknown component: ${id}`);return visualParams.parse(params);}

export const colorPresets=[
 {id:'original',name:'Original',exposure:0,contrast:1,saturation:1,temperature:0},
 {id:'warm',name:'Warm',exposure:.08,contrast:1.08,saturation:1.12,temperature:.5},
 {id:'cool',name:'Cool',exposure:0,contrast:1.1,saturation:.9,temperature:-.5},
 {id:'mono',name:'Black & white',exposure:0,contrast:1.15,saturation:0,temperature:0},
 {id:'cinematic',name:'Cinematic',exposure:-.1,contrast:1.2,saturation:.8,temperature:.1}
] as const;
