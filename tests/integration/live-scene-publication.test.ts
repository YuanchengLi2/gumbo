import {it,expect} from 'vitest';
import {mkdtempSync,readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProjectDB} from '@dream/project-db';
import {Workspace} from '../../apps/project-service/src/workspace';
import {call,textOf} from '../fixtures/agent-project';

it('applies executable scenes without a process, probe or render when project.json is written',async()=>{
 const root=mkdtempSync(join(tmpdir(),'dream-live-')),db=new ProjectDB(root);let commands=0,renders=0;
 const events:string[]=[],ws=new Workspace(db,{run:async()=>{commands++;throw Error('No command expected');},ffmpeg:'unavailable',ffprobe:'unavailable',renderReview:async request=>{renders++;return{versionId:request.versionId,frames:request.frames.map(f=>({...f,mimeType:'image/jpeg' as const,data:'dGVzdA==',sha256:'a'.repeat(64)}))};}},type=>events.push(type));
 try{
  await ws.initialize();const path=join(root,'Workspace/project.json'),doc=JSON.parse(readFileSync(path,'utf8')),source='<div id="shape"></div><script>window.renderFrame=(frame,fps)=>document.getElementById("shape").textContent=frame/fps;</script>';
  writeFileSync(join(root,'Workspace/src/scene.html'),source);
  doc.outputs=[{id:'scene',path:'src/scene.html',kind:'scene',width:640,height:360,fps:30,durationInFrames:90}];
  doc.timeline.spine=[{id:'scene',assetId:'output:scene',srcIn:0,srcOut:3,speed:1,audio:{mute:true},reason:'Live scene'}];
  expect(textOf(await call(ws,'write',{path:'project.json',content:JSON.stringify(doc,null,2)},'write-live','live'))).toMatch(/Applied/);
  expect(commands).toBe(0);expect(renders).toBe(0);expect(events).toContain('state');
  const asset=db.footage().assets[0];expect(asset.scene?.durationInFrames).toBe(90);expect(asset.sequence).toBeUndefined();expect(readFileSync(asset.originalPath,'utf8')).toBe(source);
  expect(readdirSync(join(root,'Workspace/output'))).toEqual([]);
  // Publishing drew nothing; the agent's own look at the edit asks the player's engine for the frames it chose, once,
  // and always says what is on screen there.
  const look:any=await call(ws,'look',{target:'edit',times:[1]},'inspect','live');expect(renders).toBe(1);
  const summary=JSON.parse(look.content[0].text);expect(summary.moments[0].onScreen.some((l:any)=>l.kind==='scene')).toBe(true);
  writeFileSync(join(root,'Workspace/src/scene.html'),'changed draft');expect(readFileSync(asset.originalPath,'utf8')).toBe(source);
  db.undo();expect(db.timeline().spine).toHaveLength(0);db.undo(true);expect(db.timeline().spine[0].assetId).toBe(asset.id);
 }finally{db.close();}
});

it('does not replace the published project with a baked animation output',async()=>{
 const root=mkdtempSync(join(tmpdir(),'dream-no-bake-')),db=new ProjectDB(root),ws=new Workspace(db,{run:async()=>{throw Error('Unexpected execution');},ffmpeg:'',ffprobe:''},()=>{});
 try{await ws.initialize();const before=db.head(),path=join(root,'Workspace/project.json'),doc=JSON.parse(readFileSync(path,'utf8'));doc.outputs=[{id:'movie',path:'output/frames',kind:'sequence',fps:30}];await expect(call(ws,'write',{path:'project.json',content:JSON.stringify(doc)},'baked')).rejects.toThrow(/Not applied/);expect(db.head()).toBe(before);}finally{db.close();}
});
