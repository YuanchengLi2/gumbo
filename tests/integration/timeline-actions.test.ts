import {it,expect} from 'vitest';
import {mkdtempSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProjectDB} from '@dream/project-db';
import {AssetSchema} from '@dream/footage';
import {CodeWorkspace} from '../../apps/project-service/src/code-workspace';
import {parseCodeTool,allowedTools} from '../../packages/orchestrator/src/code-tools';

const fixture=async()=>{const root=mkdtempSync(join(tmpdir(),'dream-actions-')),db=new ProjectDB(root,'Actions');
 db.saveAsset(AssetSchema.parse({id:'v',filename:'Beach.mp4',kind:'video',originalPath:join(root,'v.mp4'),durationSec:20,hasAudio:true,fingerprint:'v'}));
 const ws=new CodeWorkspace(db,{run:async()=>{throw Error('No command expected');},ffmpeg:'unavailable',ffprobe:'unavailable'},()=>{});await ws.initialize();return{root,db,ws};};
const edit=(ws:CodeWorkspace,id:string,input:any)=>ws.execute('edit_timeline',{publish:true,...input},id,'turn',new AbortController().signal);
const clip=(id:string,srcIn:number,srcOut:number)=>({id,assetId:'v',srcIn,srcOut});
const projectJson=(root:string)=>readFileSync(join(root,'Workspace/project.json'),'utf8');

it('applies timeline actions in order, publishes them and reports what changed',async()=>{
 const {db,ws}=await fixture();try{
  const first=await edit(ws,'c1',{actions:[{type:'insert_clip',position:0,clip:clip('a',2,5)},{type:'insert_clip',position:{after:'a'},clip:clip('b',6,9)}]});
  expect(first.publication.versionId).toBe(db.head());expect(db.timeline().spine.map(c=>c.id)).toEqual(['a','b']);expect(first.changes.join('\n')).toContain('spine:');
  await edit(ws,'c2',{actions:[{type:'trim_clip',clipId:'a',srcIn:2.5},{type:'move_clip',clipId:'b',position:0},{type:'set_framing',clipId:'a',framing:{mode:'fill',exposure:-.3,saturation:.6}},{type:'set_transition',clipId:'a',transition:{type:'crossfade',durationSec:.5}},{type:'set_captions',captions:{style:'clean'}}]});
  const t=db.timeline();expect(t.spine.map(c=>c.id)).toEqual(['b','a']);expect(t.spine[1]).toMatchObject({srcIn:2.5,framing:{mode:'fill',exposure:-.3,saturation:.6},transitionIn:{type:'crossfade'}});expect(t.captions?.style).toBe('clean');
 }finally{db.close();}
});

it('applies nothing when an action is wrong, and says which action and why',async()=>{
 const {root,db,ws}=await fixture();try{
  await edit(ws,'c1',{actions:[{type:'insert_clip',position:0,clip:clip('a',2,5)}]});const head=db.head(),before=projectJson(root);
  await expect(edit(ws,'c2',{actions:[{type:'set_speed',clipId:'a',speed:2},{type:'trim_clip',clipId:'zzz',srcOut:4}]})).rejects.toThrow(/Action 2 \(trim_clip\): Clip zzz does not exist\. Clips on the timeline: a\./);
  await expect(edit(ws,'c3',{actions:[{type:'trim_clip',clipId:'a',srcOut:25}]})).rejects.toThrow(/clip a ends at 25s but its source is 20s long/);
  await expect(edit(ws,'c4',{actions:[{type:'insert_clip',position:1,clip:{...clip('b',0,2),assetId:'output:intro'}}]})).rejects.toThrow(/output:intro, which is not declared/);
  await expect(edit(ws,'c5',{actions:[{type:'set_speed',clipId:'a',speed:9}]})).rejects.toThrow(/Action 1 \(set_speed\): speed/);
  expect(db.head()).toBe(head);expect(projectJson(root)).toBe(before);
 }finally{db.close();}
});

it('refuses to strand items anchored to a deleted clip',async()=>{
 const {db,ws}=await fixture();try{
  await edit(ws,'c1',{actions:[{type:'insert_clip',position:0,clip:clip('a',2,5)},{type:'insert_clip',position:1,clip:clip('b',6,9)},{type:'add_item',item:{id:'title',type:'overlay',component:'source',source:{assetId:'v',srcIn:0,srcOut:2},start:{kind:'clip',clipId:'b',at:'start'},durationSec:2}}]});
  await expect(edit(ws,'c2',{actions:[{type:'delete_clips',clipIds:['b']}]})).rejects.toThrow(/item title is anchored to clip b/);
  await edit(ws,'c3',{actions:[{type:'delete_clips',clipIds:['b']},{type:'remove_item',itemId:'title'}]});expect(db.timeline().spine.map(c=>c.id)).toEqual(['a']);
 }finally{db.close();}
});

it('replays an interrupted or repeated call without applying its actions twice',async()=>{
 const {db,ws}=await fixture();try{
  const input={actions:[{type:'insert_clip',position:0,clip:clip('a',2,5)}]};
  const first=await edit(ws,'c1',input),again=await edit(ws,'c1',input);
  expect(again.publication.versionId).toBe(first.publication.versionId);expect(db.timeline().spine).toHaveLength(1);
 }finally{db.close();}
});

it('gives timeline actions to editors and the publishing worker only',()=>{
 expect(allowedTools('solo').has('edit_timeline')).toBe(true);expect(allowedTools('worker',{canPublish:true}).has('edit_timeline')).toBe(true);
 expect(allowedTools('worker',{canPublish:false}).has('edit_timeline')).toBe(false);expect(allowedTools('lead').has('edit_timeline')).toBe(false);expect(allowedTools('readonly').has('edit_timeline')).toBe(false);
 // Actions are checked where they are applied, so a malformed one still reaches the workspace and gets a precise error.
 expect(parseCodeTool('edit_timeline',{actions:[{type:'trim_clip',clipId:'a',srcOut:'x'}]}).actions).toHaveLength(1);
});

it('places media the agent produced with its own tools, such as a cleaned-up recording, as a video output',async()=>{
 const {db,root}=await fixture();try{
  const {spawnSync}=await import('node:child_process'),{mkdirSync}=await import('node:fs'),ffmpeg=(await import('ffmpeg-static')).default!,ffprobe=(await import('ffprobe-static')).default.path;
  const ws=new CodeWorkspace(db,{run:async()=>{throw Error('No command expected');},ffmpeg,ffprobe},()=>{});await ws.initialize();
  mkdirSync(join(root,'Workspace/output'),{recursive:true});
  const made=spawnSync(ffmpeg,['-y','-v','error','-f','lavfi','-i','testsrc2=s=320x180:r=30:d=3','-f','lavfi','-i','sine=frequency=300:duration=3','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',join(root,'Workspace/output/clean.mp4')],{windowsHide:true});expect(made.status).toBe(0);
  await edit(ws,'c1',{outputs:[{id:'clean',path:'output/clean.mp4',kind:'video'}],actions:[{type:'insert_clip',position:0,clip:{id:'a',assetId:'output:clean',srcIn:0,srcOut:3}}]});
  const placed=db.footage().assets.find(a=>a.id===db.timeline().spine[0].assetId)!;expect(placed).toMatchObject({kind:'video',hasAudio:true});expect(placed.durationSec).toBeCloseTo(3,0);
 }finally{db.close();}
},60_000);
