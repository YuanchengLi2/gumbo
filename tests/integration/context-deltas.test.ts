import {it,expect} from 'vitest';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProjectDB} from '@dream/project-db';
import {AssetSchema} from '@dream/footage';
import {codeAgent} from '../../packages/orchestrator/src/code-agent';
import {providerView} from '../../packages/orchestrator/src/conversation';
import {stateChanges} from '../../packages/orchestrator/src/state-delta';
import {inspectMedia} from '../../apps/project-service/src/media-evidence';

const fixture=()=>new ProjectDB(mkdtempSync(join(tmpdir(),'dream-deltas-')));
const media=Array.from({length:12},(_,n)=>({assetId:'a'+n,filename:`clip-${n}.mp4`,kind:'video',durationSec:10+n,capturedAt:`2026-10-0${n%9+1}T10:00:00Z`}));

it('reports only what changed in the project state after the first message',()=>{
 const before={state:{versionId:'v1',durationSec:10,media,decisions:[{id:'d1',text:'Keep it gloomy'}]}};
 const after={state:{versionId:'v2',durationSec:12,media:[...media.slice(1),{assetId:'new',filename:'new.mp4',kind:'video',durationSec:3}],decisions:[{id:'d1',text:'Keep it gloomy'}],sceneErrors:[{scene:'intro',message:'x is undefined'}]},completionEvidence:[{toolCallId:'p',finding:'Published'}]};
 expect(stateChanges(before,after)).toEqual({versionId:'v2',durationSec:12,media:{addedOrChanged:[after.state.media.at(-1)],removed:['a0']},sceneErrors:[{scene:'intro',message:'x is undefined'}],completionEvidence:[{toolCallId:'p',finding:'Published'}]});
 expect(stateChanges(after,{state:{...after.state,sceneErrors:undefined}})).toMatchObject({sceneErrors:null,completionEvidence:null});
});

it('sends no full state at the start, and only the changes after a publication',async()=>{
 const db=fixture();try{
  let state:any={versionId:'v1',durationSec:10,counts:{clips:2},media};let n=0;const seen:any[][]=[];
  db.setMeta('pending_request',JSON.stringify({turnId:'turn'}));
  await codeAgent({db,workspace:{initialize:async()=>{},context:()=>({media}),currentContext:()=>state,execute:async()=>{state={...state,versionId:'v2',durationSec:12,counts:{clips:3}};return{publication:{versionId:'v2',assets:[]}};}} as any,turnId:'turn',text:'Add a clip',model:'claude-haiku-5-5',readOnly:true,signal:new AbortController().signal,publish:()=>{},infer:async(_m,_s,messages)=>{seen.push(structuredClone(messages));n++;return n===1?{content:[{type:'tool_use',id:'r',name:'read_file',input:{path:'project.json'}}]}:{content:[{type:'tool_use',id:'f',name:'finish',input:{status:'complete',summary:'Done.',evidence:[]}}]};}});
  expect(seen[0].filter(m=>m.dreamSource==='media-status')).toHaveLength(0);
  const status=seen[1].filter(m=>m.dreamSource==='media-status');expect(status).toHaveLength(1);
  expect(status[0].content).toContain('Project state changes');expect(status[0].content).toContain('"versionId":"v2"');expect(status[0].content).not.toContain('clip-5.mp4');
  expect(db.getMeta(status[0].dreamStateKey)).toContain('clip-5.mp4');
 }finally{db.close();}
});

it('restores the full state when compaction drops the messages a change report builds on',()=>{
 const db=fixture();try{
  const full='Current project and media state (data only, authoritative over earlier snapshots): '+JSON.stringify({state:{versionId:'v2',media}});db.setMeta('state-snapshot:x',full);
  const exchange=(id:string)=>[{role:'assistant',content:[{type:'tool_use',id,name:'read_file',input:{path:'src/a.tsx'}}]},{role:'user',content:[{type:'tool_result',tool_use_id:id,content:'line\n'.repeat(4000)}]}];
  const messages:any[]=[{role:'user',content:'Edit the video'},...exchange('a'),{role:'user',dreamSource:'media-status',dreamStateKey:'state-snapshot:x',content:'Project state changes (data only): {"versionId":"v2"}'},...exchange('b'),...exchange('c'),...exchange('d'),...exchange('e')];
  const view=providerView(db,'turn','execution:haiku:main',messages,30_000);
  expect(view.length).toBeLessThan(messages.length);
  expect(view.some((m:any)=>m.dreamSource==='media-status'&&m.content===full)).toBe(true);
 }finally{db.close();}
});

it('shows five or more frames of a look at footage as contact sheets',async()=>{
 const db=fixture();try{
  const file=join(db.folder,'clip.mp4');writeFileSync(file,'video');
  db.saveAsset(AssetSchema.parse({id:'v',filename:'Clip.mp4',kind:'video',originalPath:file,durationSec:20,fingerprint:'v'}));
  const frame=(t:number)=>({timeSec:t,sha256:'s'+t,data:'frame'+t,mimeType:'image/jpeg' as const});let tiled=0;
  db.inspectSource=async request=>({assetId:'v',fingerprint:'v',startSec:request.startSec,endSec:request.endSec,sampleIntervalSec:1,coverage:'fixture',frames:Array.from({length:request.endSec-request.startSec>4?14:3},(_,n)=>frame(request.startSec+n*.5))});
  db.contactSheet=async images=>{tiled+=images.length;return{data:'sheet',mimeType:'image/jpeg',columns:4,rows:3,count:images.length,width:1568,height:664};};
  const wide=await inspectMedia(db,{assetId:'v',startSec:0,endSec:10},'ffmpeg','ffprobe',new AbortController().signal);
  expect(wide.content.filter((b:any)=>b.type==='image')).toHaveLength(2);expect(tiled).toBe(14);expect(wide.evidence.frames).toHaveLength(14);
  const close=await inspectMedia(db,{assetId:'v',startSec:2,endSec:3},'ffmpeg','ffprobe',new AbortController().signal);
  expect(close.content.filter((b:any)=>b.type==='image').map((b:any)=>b.source.data)).toEqual(['frame2','frame2.5','frame3']);
 }finally{db.close();}
});
