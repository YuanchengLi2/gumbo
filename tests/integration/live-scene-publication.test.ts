import {it,expect} from 'vitest';
import {mkdtempSync,readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProjectDB} from '@dream/project-db';
import {CodeWorkspace} from '../../apps/project-service/src/code-workspace';
import {codeAgent} from '../../packages/orchestrator/src/code-agent';

it('publishes executable scenes without a process, probe or render and finishes from that publication',async()=>{
 const root=mkdtempSync(join(tmpdir(),'dream-live-')),db=new ProjectDB(root);let commands=0,renders=0;
 const events:string[]=[],ws=new CodeWorkspace(db,{run:async()=>{commands++;throw Error('No command expected');},ffmpeg:'unavailable',ffprobe:'unavailable',renderReview:async request=>{renders++;return{versionId:request.versionId,frames:request.frames.map(f=>({...f,mimeType:'image/jpeg' as const,data:'dGVzdA==',sha256:'a'.repeat(64)}))};}},type=>events.push(type));
 try{
  await ws.initialize();const path=join(root,'Workspace/project.json'),doc=JSON.parse(readFileSync(path,'utf8')),source='<div id="shape"></div><script>window.renderFrame=(frame,fps)=>document.getElementById("shape").textContent=frame/fps;</script>';
  writeFileSync(join(root,'Workspace/src/scene.html'),source);
  doc.outputs=[{id:'scene',path:'src/scene.html',kind:'scene',width:640,height:360,fps:30,durationInFrames:90}];
  doc.timeline.spine=[{id:'scene',assetId:'output:scene',srcIn:0,srcOut:3,speed:1,audio:{mute:true},reason:'Live scene'}];writeFileSync(path,JSON.stringify(doc));
  let calls=0;
  const result=await codeAgent({db,workspace:ws,turnId:'live',text:'Make this scene',model:'fixture',signal:new AbortController().signal,publish:()=>{},infer:async()=>({content:[calls++===0?{type:'tool_use',id:'publish-live',name:'publish_project',input:{}}:{type:'tool_use',id:'finish-live',name:'finish',input:{status:'complete',summary:'Saved.',evidence:[{toolCallId:'publish-live',finding:'Published scene source.'}]}}]})});
  expect(result.outcome.status).toBe('complete');expect(calls).toBe(2);expect(commands).toBe(0);expect(renders).toBe(0);expect(events).toContain('state');
  const asset=db.footage().assets[0];expect(asset.scene?.durationInFrames).toBe(90);expect(asset.sequence).toBeUndefined();expect(readFileSync(asset.originalPath,'utf8')).toBe(source);
  expect(readdirSync(join(root,'Workspace/output'))).toEqual([]);
  // Nothing renders during chat: the preview check returns metadata and the live player runs the published code.
  const metadata=await ws.execute('view_media',{target:'preview'},'inspect','live',new AbortController().signal);expect(metadata.preview).toBe('live');expect(metadata.evidence).toBeUndefined();expect(renders).toBe(0);
  writeFileSync(join(root,'Workspace/src/scene.html'),'changed draft');expect(readFileSync(asset.originalPath,'utf8')).toBe(source);
  db.undo();expect(db.timeline().spine).toHaveLength(0);db.undo(true);expect(db.timeline().spine[0].assetId).toBe(asset.id);
 }finally{db.close();}
});

it('does not replace the published project with a baked animation output',async()=>{
 const root=mkdtempSync(join(tmpdir(),'dream-no-bake-')),db=new ProjectDB(root),ws=new CodeWorkspace(db,{run:async()=>{throw Error('Unexpected execution');},ffmpeg:'',ffprobe:''},()=>{});
 try{await ws.initialize();const before=db.head(),path=join(root,'Workspace/project.json'),doc=JSON.parse(readFileSync(path,'utf8'));doc.outputs=[{id:'movie',path:'output/frames',kind:'sequence',fps:30}];writeFileSync(path,JSON.stringify(doc));await expect(ws.execute('publish_project',{},'baked','turn',new AbortController().signal)).rejects.toThrow();expect(db.head()).toBe(before);}finally{db.close();}
});
