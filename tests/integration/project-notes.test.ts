import {it,expect} from 'vitest';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProjectDB} from '@dream/project-db';
import {AssetSchema} from '@dream/footage';
import {Director} from '../../packages/orchestrator/src/code-director';
import {ProjectContext} from '../../packages/orchestrator/src/context';
import {timelineOutline} from '../../packages/orchestrator/src/timeline-outline';

const fixture=()=>{const db=new ProjectDB(mkdtempSync(join(tmpdir(),'dream-notes-')));
 db.saveAsset(AssetSchema.parse({id:'v',filename:'Beach.mp4',kind:'video',originalPath:'v.mp4',durationSec:20,hasAudio:true,fingerprint:'v'}));
 const clip=(id:string,srcIn:number,srcOut:number,extra:any={})=>({id,assetId:'v',srcIn,srcOut,speed:1,audio:{gainDb:0,fadeInSec:.01,fadeOutSec:.01,mute:false},reason:'Fixture',...extra});
 db.apply([{type:'insert_clip',position:0,clip:clip('a',2,6),reason:'Fixture'},{type:'insert_clip',position:1,clip:clip('b',8,12,{speed:2,framing:{mode:'fill',scale:1,x:.5,y:.5,saturation:.6},transitionIn:{type:'crossfade',durationSec:.5}}),reason:'Fixture'},{type:'set_captions',captions:{style:'clean',params:{},overrides:[]},reason:'Fixture'}] as any,'Fixture','fixture',db.head());
 return db;};

it('outlines what is in the video, in order, with each clip and item on the timeline',()=>{
 const db=fixture();try{
  const outline=timelineOutline(db.timeline(),db.footage());
  expect(outline.durationSec).toBe(6);
  expect(outline.lines).toEqual(['1. a at 0s-4s: Beach.mp4 2s-6s','2. b at 4s-6s: Beach.mp4 8s-12s, speed 2, fill, saturation 0.6, crossfade in','captions: clean']);
  expect(new ProjectContext(db).initial('make it warmer').timeline.lines).toHaveLength(3);
 }finally{db.close();}
});

it('keeps the notes an editor writes when finishing and shows them to the next request',async()=>{
 const db=fixture();try{
  const seen:string[]=[];const workspace={initialize:async()=>{},context:(q:string)=>({project:new ProjectContext(db).initial(q)}),execute:async()=>({publication:{versionId:db.head(),assets:[],unchanged:true}})};
  const director=new Director(db,async()=>({url:'fixture',token:'fixture'}),()=>{},undefined,undefined,undefined,undefined,workspace);db.setMeta('project_title_source','ai');
  director.inference=async(_m,_s,messages:any)=>{seen.push(JSON.stringify(messages[0]));return messages.some((m:any)=>m.role==='assistant')?{content:[{type:'tool_use',id:'done',name:'finish',input:{status:'complete',summary:'Darker now.',notes:'The user wants a gloomy, cinematic mood; keep cuts slow.'}}],stop_reason:'tool_use',usage:{}}:{content:[{type:'tool_use',id:'pub',name:'publish_project',input:{}}],stop_reason:'tool_use',usage:{}};};
  await director.message('Make it feel more gloomy');expect(db.getMeta('preferences')).toBe('The user wants a gloomy, cinematic mood; keep cuts slow.');
  await director.message('Add a crossfade to the first clip');expect(seen.at(-1)).toContain('gloomy, cinematic mood');
 }finally{db.close();}
});
