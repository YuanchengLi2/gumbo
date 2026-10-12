import {it,expect} from 'vitest';
import {mkdtempSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import {ProjectDB} from '@dream/project-db';
import {AssetSchema} from '@dream/footage';
import {emptyTimeline} from '@dream/timeline';
import {models} from '@dream/config';
import {CodeWorkspace} from '../../apps/project-service/src/code-workspace';
import {editChecks} from '../../apps/project-service/src/edit-checks';
import {codeAgent,capText} from '../../packages/orchestrator/src/code-agent';
import {allowedTools} from '../../packages/orchestrator/src/code-tools';

// A 20-second source with speech: "hello" 1.0-1.5, "world" 1.6-2.0, then four seconds of silence, "again" 6.0-6.4.
const fixture=async(tools:{ffmpeg:string;ffprobe:string}={ffmpeg:'unavailable',ffprobe:'unavailable'})=>{const root=mkdtempSync(join(tmpdir(),'dream-code-first-')),db=new ProjectDB(root,'Code first');
 db.saveAsset(AssetSchema.parse({id:'v',filename:'Talk.mp4',kind:'video',originalPath:join(root,'v.mp4'),durationSec:20,hasAudio:true,fingerprint:'v',status:'ready'}));
 db.saveRecords('words',[['hello',1,1.5],['world',1.6,2],['again',6,6.4]].map(([text,start,end],n)=>({id:'w'+n,assetId:'v',text,start,end,confidence:1,speaker:'unknown',pauseBefore:0})) as any);
 const ws=new CodeWorkspace(db,{run:async()=>{throw Error('No command expected');},...tools},()=>{});await ws.initialize();return{root,db,ws};};
const clip=(id:string,srcIn:number,srcOut:number,extra:object={})=>({id,assetId:'v',srcIn,srcOut,speed:1,audio:{gainDb:0,fadeInSec:.01,fadeOutSec:.01,mute:false},reason:'',...extra});
const document=(root:string)=>JSON.parse(readFileSync(join(root,'Workspace/project.json'),'utf8'));
const signal=()=>new AbortController().signal;

it('edits only through project.json: no timeline actions for any role',()=>{
 for(const role of ['solo','worker','readonly'] as const)expect([...allowedTools(role,{canDelegate:true})]).not.toContain('edit_timeline');
 expect(allowedTools('solo').has('write_file')).toBe(true);expect(allowedTools('solo').has('publish_project')).toBe(true);
});

it('publishes a project.json the agent wrote, and refuses one that reaches past its source or strands an item, changing nothing',async()=>{
 const {root,db,ws}=await fixture();try{
  const doc=document(root);doc.timeline.spine=[clip('a',2,5),clip('b',8,10)];
  await ws.execute('write_file',{path:'project.json',content:JSON.stringify(doc)},'w1','turn',signal());
  const published=await ws.execute('publish_project',{},'p1','turn',signal());expect(db.timeline().spine.map(c=>c.id)).toEqual(['a','b']);expect(published.publication.versionId).toBe(db.head());
  const head=db.head(),next=document(root);
  next.timeline.spine[1].srcOut=25;await ws.execute('write_file',{path:'project.json',content:JSON.stringify(next)},'w2','turn',signal());
  await expect(ws.execute('publish_project',{},'p2','turn',signal())).rejects.toThrow(/exceeds|20/);
  next.timeline.spine[1].srcOut=10;next.timeline.attached=[{id:'title',type:'overlay',component:'lower_third',start:{kind:'clip',clipId:'gone',at:'start',offsetSec:0},durationSec:2,params:{text:'Hi'},layer:1,reason:''}];
  await ws.execute('write_file',{path:'project.json',content:JSON.stringify(next)},'w3','turn',signal());
  await expect(ws.execute('publish_project',{},'p3','turn',signal())).rejects.toThrow(/cannot be placed|title/);
  expect(db.head()).toBe(head);
 }finally{db.close();}
});

it('checks what an edit changed from facts: footage used twice, a cut inside a word, long silence; notes slow motion',()=>{
 const footage={assets:[AssetSchema.parse({id:'v',filename:'Talk.mp4',kind:'video',originalPath:'v.mp4',durationSec:20,hasAudio:true,fingerprint:'v'})],words:[['hello',1,1.5],['world',1.6,2],['again',6,6.4]].map(([text,start,end],n)=>({id:'w'+n,assetId:'v',text,start,end,confidence:1,speaker:'unknown',pauseBefore:0})),shots:[],faces:[],revision:1} as any;
 const before=emptyTimeline('t'),after=emptyTimeline('t');after.spine=[clip('a',1.2,7),clip('b',2,5),clip('c',10,12,{speed:.4})] as any;
 const checks=editChecks(before,after,footage);
 expect(checks.mustFix.map(c=>c.id).sort()).toEqual(['inside-word:a:in','repeat:a:b','silence:a:2']);
 expect(checks.mustFix.find(c=>c.id==='inside-word:a:in')!.text).toContain('"hello"');expect(checks.notes.map(c=>c.id)).toContain('slow:c');
 // A cut between words, with the pause removed, is clean; a muted clip's words are not judged.
 const clean=emptyTimeline('t');clean.spine=[clip('a',.9,2.1),clip('b',5.9,6.5),clip('m',1.2,7,{audio:{gainDb:0,fadeInSec:.01,fadeOutSec:.01,mute:true}})] as any;
 expect(editChecks(before,clean,footage).mustFix).toEqual([]);
});

it('will not finish while the published edit has unresolved must-fix checks, and finishes once they are kept with a reason',async()=>{
 const {root,db,ws}=await fixture();try{
  const doc=document(root);doc.timeline.spine=[clip('a',1.2,7),clip('b',2,5)];
  let step=0;const replies:string[]=[];
  const result=await codeAgent({db,workspace:ws,turnId:'turn',text:'Cut the talk',model:models.agent,signal:signal(),publish:()=>{},infer:async(_model:string,_system:string,messages:any[])=>{
   replies.length=0;for(const m of messages)if(Array.isArray(m?.content))for(const b of m.content)if(b.type==='tool_result')replies.push(typeof b.content==='string'?b.content:JSON.stringify(b.content));
   step++;
   if(step===1)return{stop_reason:'tool_use',content:[{type:'tool_use',id:'write',name:'write_file',input:{path:'project.json',content:JSON.stringify(doc)}}]};
   if(step===2)return{stop_reason:'tool_use',content:[{type:'tool_use',id:'publish',name:'publish_project',input:{}}]};
   if(step===3)return{stop_reason:'tool_use',content:[{type:'tool_use',id:'done1',name:'finish',input:{status:'complete',summary:'Cut it.',evidence:[]}}]};
   return{stop_reason:'tool_use',content:[{type:'tool_use',id:'done2',name:'finish',input:{status:'complete',summary:'Cut it; kept the repeat and the pause on purpose.',evidence:[],kept:['repeat:a:b','silence:a:2','inside-word:a:in'].map(check=>({check,reason:'Wanted for this test.'}))}}]};
  }} as any);
  expect(replies.find(r=>r.includes('"mustFix"'))).toContain('repeat:a:b');
  expect(replies.find(r=>r.includes('The published edit still has'))).toMatch(/\[inside-word:a:in\].*\[silence:a:2\]|\[repeat:a:b\]/);
  expect(result.outcome.status).toBe('complete');expect(step).toBe(4);
 }finally{db.close();}
},60_000);

it('never reports an edit with must-fix checks as done when the agent just stops with a reply: it is told why, then the request ends blocked',async()=>{
 const {root,db,ws}=await fixture();try{
  const doc=document(root);doc.timeline.spine=[clip('a',1.2,7),clip('b',2,5)];
  let step=0;const nudges:string[]=[];
  const result=await codeAgent({db,workspace:ws,turnId:'turn',text:'Cut the talk',model:models.agent,signal:signal(),publish:()=>{},infer:async(_model:string,_system:string,messages:any[])=>{
   step++;const last=messages.at(-1);if(last?.dreamSource==='nudge')nudges.push(String(last.content));
   if(step===1)return{stop_reason:'tool_use',content:[{type:'tool_use',id:'write',name:'write_file',input:{path:'project.json',content:JSON.stringify(doc)}}]};
   if(step===2)return{stop_reason:'tool_use',content:[{type:'tool_use',id:'publish',name:'publish_project',input:{}}]};
   // What Haiku did in the live run: say it is not finished, and end the turn anyway.
   return{stop_reason:'end_turn',content:[{type:'text',text:'The cut is published, but it isn\'t finished: some silences remain.'}]};
  }} as any);
  expect(nudges.length).toBeGreaterThan(0);expect(nudges[0]).toContain('The request is not finished');expect(nudges[0]).toContain('[repeat:a:b]');
  expect(result.outcome.status).toBe('blocked');expect(result.outcome.summary).toContain('The published edit still has');
  expect((result.outcome as any).nextAction).toContain('fix');
 }finally{db.close();}
},60_000);

it('never reports an edit as done when a delegated task ended blocked and the agent keeps replying instead of finishing',async()=>{
 const {root,db,ws}=await fixture();try{
  const doc=document(root);doc.timeline.spine=[clip('a',2.2,4)];
  let step=0;
  const result=await codeAgent({db,workspace:ws,turnId:'turn',text:'Trim the opening and add a title scene',model:models.agent,signal:signal(),publish:()=>{},
   runWorkers:async(tasks:any[])=>tasks.map(t=>({taskId:t.id,title:t.title,status:'blocked',summary:'The scene failed to compile.'})),
   infer:async()=>{
    step++;
    if(step===1)return{stop_reason:'tool_use',content:[{type:'tool_use',id:'write',name:'write_file',input:{path:'project.json',content:JSON.stringify(doc)}}]};
    if(step===2)return{stop_reason:'tool_use',content:[{type:'tool_use',id:'publish',name:'publish_project',input:{}}]};
    if(step===3)return{stop_reason:'tool_use',content:[{type:'tool_use',id:'delegate',name:'delegate',input:{tasks:[{id:'title',title:'Title scene',brief:'b',writes:['src/title']}]}}]};
    return{stop_reason:'end_turn',content:[{type:'text',text:'Trimmed the opening.'}]};
   }} as any);
  expect(result.outcome.status).toBe('blocked');expect(result.outcome.summary).toContain('Delegated tasks title ended blocked');
  expect((result.outcome as any).nextAction).toContain('fix');
 }finally{db.close();}
},60_000);

it('caps the text of every result, including a look at footage that mixes text and images',()=>{
 const look=[{type:'text',text:'x'.repeat(30_000)},{type:'image',source:{type:'base64',media_type:'image/jpeg',data:'img'}},{type:'text',text:'y'.repeat(5_000)}];
 const capped=capText(look,'receipt-1') as any[];
 expect(capped.filter(b=>b.type==='text').reduce((n,b)=>n+b.text.length,0)).toBeLessThan(24_000+300);
 expect(capped.some(b=>b.type==='image')).toBe(true);expect(capped.at(-1).text).toContain('receipt-1');
 const small=[{type:'text',text:'short'}];expect(capText(small,'r')).toBe(small);
});

it('completes an edit when the agent stops with a reply once everything is published and nothing is left to fix',async()=>{
 const {root,db,ws}=await fixture();try{
  const doc=document(root);doc.timeline.spine=[clip('a',2.2,4)];
  let step=0;
  const result=await codeAgent({db,workspace:ws,turnId:'turn',text:'Trim the opening',model:models.agent,signal:signal(),publish:()=>{},infer:async()=>{
   step++;
   if(step===1)return{stop_reason:'tool_use',content:[{type:'tool_use',id:'write',name:'write_file',input:{path:'project.json',content:JSON.stringify(doc)}}]};
   if(step===2)return{stop_reason:'tool_use',content:[{type:'tool_use',id:'publish',name:'publish_project',input:{}}]};
   return{stop_reason:'end_turn',content:[{type:'text',text:'Trimmed the opening.'}]};
  }} as any);
  expect(result.outcome).toMatchObject({status:'complete',summary:'Trimmed the opening.'});expect(step).toBe(3);
 }finally{db.close();}
},60_000);

it('lets the agent look at an image its code made',async()=>{
 const {root,db,ws}=await fixture({ffmpeg:ffmpeg!,ffprobe:ffprobe.path});try{
  mkdirSync(join(root,'Workspace/output'),{recursive:true});const sheet=join(root,'Workspace/output/sheet.png');
  expect(spawnSync(ffmpeg!,['-y','-v','error','-f','lavfi','-i','color=c=red:s=640x360','-frames:v','1',sheet]).status).toBe(0);
  const result=await ws.execute('read_file',{path:'output/sheet.png'},'r1','turn',signal());
  const image=result.content.find((b:any)=>b.type==='image');expect(image.source.media_type).toBe('image/jpeg');expect(Buffer.from(image.source.data,'base64')[0]).toBe(255);
 }finally{db.close();}
});

it('places media the agent produced with its own tools, such as a cleaned-up recording, as a video output',async()=>{
 const {db,root}=await fixture({ffmpeg:ffmpeg!,ffprobe:ffprobe.path});try{
  mkdirSync(join(root,'Workspace/output'),{recursive:true});
  expect(spawnSync(ffmpeg!,['-y','-v','error','-f','lavfi','-i','testsrc2=s=320x180:r=30:d=3','-f','lavfi','-i','sine=frequency=300:duration=3','-c:v','libx264','-pix_fmt','yuv420p','-c:a','aac','-shortest',join(root,'Workspace/output/clean.mp4')],{windowsHide:true}).status).toBe(0);
  const ws=new CodeWorkspace(db,{run:async()=>{throw Error('No command expected');},ffmpeg:ffmpeg!,ffprobe:ffprobe.path},()=>{});await ws.initialize();
  const doc=document(root);doc.outputs=[{id:'clean',path:'output/clean.mp4',kind:'video'}];doc.timeline.spine=[{...clip('a',0,3),assetId:'output:clean'}];
  writeFileSync(join(root,'Workspace/project.json'),JSON.stringify(doc));await ws.execute('publish_project',{},'p1','turn',signal());
  const placed=db.footage().assets.find(a=>a.id===db.timeline().spine[0].assetId)!;expect(placed).toMatchObject({kind:'video',hasAudio:true});expect(placed.durationSec).toBeCloseTo(3,0);
 }finally{db.close();}
},60_000);

it('streams the agent\'s edit to the editor as project.json changes, before it is published, and clears it on publish',async()=>{
 const {root,db}=await fixture(),events:any[]=[];
 const ws=new CodeWorkspace(db,{run:async()=>{throw Error('No command expected');},ffmpeg:'unavailable',ffprobe:'unavailable'},(type:string,payload:any)=>{if(type==='workspace.draft')events.push(payload.draft);});await ws.initialize();
 try{
  const doc=document(root);doc.timeline.spine=[clip('a',1.2,7),clip('b',8,10)];
  // A scene declared but not built yet shows as a placeholder of its declared length.
  doc.outputs=[{id:'intro',path:'src/intro.tsx',kind:'scene',durationInFrames:90}];doc.timeline.spine.unshift({...clip('title',0,3),assetId:'output:intro'});
  await ws.execute('write_file',{path:'project.json',content:JSON.stringify(doc)},'w1','turn',signal());
  const draft=events.at(-1);expect(draft.timeline.spine.map((c:any)=>c.id)).toEqual(['title','a','b']);
  expect(draft.pending).toEqual([{assetId:'output:intro',outputId:'intro',kind:'scene',path:'src/intro.tsx'}]);expect(draft.assets[0]).toMatchObject({id:'output:intro',durationSec:3});
  // Half-written: the error comes back with no timeline, so the editor keeps the last good draft.
  await ws.execute('write_file',{path:'project.json',content:'{"format":"dream-'},'w2','turn',signal());
  expect(events.at(-1)).toMatchObject({error:expect.stringContaining('being written')});expect(events.at(-1).timeline).toBeUndefined();
  // Publishing makes it the edit: the draft clears.
  doc.outputs=[];doc.timeline.spine=[clip('a',1.2,4)];await ws.execute('write_file',{path:'project.json',content:JSON.stringify(doc)},'w3','turn',signal());
  expect(events.at(-1).timeline.spine.map((c:any)=>c.id)).toEqual(['a']);
  await ws.execute('publish_project',{},'p1','turn',signal());expect(events.at(-1)).toBeNull();
  // An unchanged file is not sent again.
  const count=events.length;await ws.execute('write_file',{path:'notes.txt',content:'x'},'w4','turn',signal());expect(events.length).toBe(count);
 }finally{db.close();}
},60_000);
