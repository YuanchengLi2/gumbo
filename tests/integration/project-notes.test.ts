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

it('keeps what the agent saw in each source and lists it with the media for later requests',async()=>{
 const db=fixture();try{
  const {CodeWorkspace}=await import('../../apps/project-service/src/code-workspace');const {codeAgent}=await import('../../packages/orchestrator/src/code-agent');
  db.setMeta('pending_request',JSON.stringify({turnId:'turn'}));
  await codeAgent({db,workspace:{initialize:async()=>{},context:()=>({}),execute:async()=>({ok:true})} as any,turnId:'turn',text:'What is in my footage?',model:'claude-haiku-5-5',readOnly:true,signal:new AbortController().signal,publish:()=>{},infer:async()=>({content:[{type:'tool_use',id:'f',name:'finish',input:{status:'complete',summary:'Beach footage.',sourceNotes:[{assetId:'v',note:'Sunset beach: wide shots 0-8s, shaky handheld 8-12s, close waves 12-20s.'},{assetId:'missing',note:'Ignored.'}]}}]})});
  const ws=new CodeWorkspace(db,{run:async()=>{throw Error('No command expected');},ffmpeg:'unavailable',ffprobe:'unavailable'},()=>{});
  expect(ws.mediaContext()[0]).toMatchObject({assetId:'v',seen:'Sunset beach: wide shots 0-8s, shaky handheld 8-12s, close waves 12-20s.'});
  expect(Object.keys(JSON.parse(db.getMeta('source-notes')!))).toEqual(['v']);
 }finally{db.close();}
});

it('starts every request with the same cached briefing, followed by the request and what it depends on',async()=>{
 const db=fixture();try{
  const {CodeWorkspace}=await import('../../apps/project-service/src/code-workspace');const {briefing}=await import('../../packages/orchestrator/src/code-agent');
  const ws=new CodeWorkspace(db,{run:async()=>{throw Error('No command expected');},ffmpeg:'unavailable',ffprobe:'unavailable'},()=>{});await ws.initialize();
  const first=briefing(ws.context('Make it warmer'),'Make it warmer',{projectTitle:'Notes'}) as any[],second=briefing(ws.context('Swap the first two clips'),'Swap the first two clips',{projectTitle:'Notes'}) as any[];
  expect(first[0].cache_control).toEqual({type:'ephemeral'});expect(first[0].text).toBe(second[0].text);
  expect(first[0].text).toContain('Beach.mp4');expect(first[0].text).not.toContain('"now"');expect(first[0].text).not.toContain('Make it warmer');
  expect(first[1].text.startsWith('Make it warmer\nProject context: ')).toBe(true);expect(first[1].text).toContain('"now"');expect(first[1].text).toContain('Beach.mp4 2s-6s');
 }finally{db.close();}
});

it('keeps the cached briefing the same when the agent rewrites its notes or makes new media',async()=>{
 const {briefing}=await import('../../packages/orchestrator/src/code-agent');
 const base={capabilities:{},environment:{},computer:{access:false,now:'t1'},media:[{assetId:'a',filename:'a.mp4'},{assetId:'b',filename:'b.mp4'}]};
 const later={...base,computer:{access:false,now:'t2'},media:[{assetId:'a',filename:'a.mp4',seen:'A beach at sunset'},{assetId:'b',filename:'b.mp4'},{assetId:'code_1',filename:'title.tsx',kind:'video'}]};
 const first=briefing(base,'Make it warmer',{}) as any[],second=briefing(later,'Add a title',{}) as any[];
 expect(second[0].text).toBe(first[0].text);
 expect(second[1].text).toContain('"sourceNotes":{"a":"A beach at sunset"}');expect(second[1].text).toContain('"generatedMedia":["code_1 ');
});
