import {it,expect} from 'vitest';
import {mkdtempSync,readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {ProjectDB} from '@dream/project-db';
import {CodeWorkspace} from '../../apps/project-service/src/code-workspace';

const fixture=()=>{const root=mkdtempSync(join(tmpdir(),'dream-engine-pub-')),db=new ProjectDB(root,'Engine');const ws=new CodeWorkspace(db,{run:async()=>{throw Error('No command expected');},ffmpeg:'unavailable',ffprobe:'unavailable'},()=>{});return{root,db,ws};};
const write=(root:string,path:string,text:string|Buffer)=>{const target=join(root,'Workspace',path);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,text);};
const doc=(root:string)=>JSON.parse(readFileSync(join(root,'Workspace/project.json'),'utf8'));
const publish=(ws:CodeWorkspace,id:string)=>ws.execute('publish_project',{},id,'turn',new AbortController().signal);

it('publishes a TSX scene as an engine asset with its resources, at the project frame size, from one component with props',async()=>{
 const {root,db,ws}=fixture();try{await ws.initialize();
  write(root,'src/card.tsx',"import {useCurrentFrame} from 'remotion';\nimport {FitText,resource} from '@dream/engine';\nimport {theme} from './theme';\nexport default function Card({title}:{title:string}){useCurrentFrame();return <div style={{background:theme,backgroundImage:`url(${resource('paper.png')})`}}><FitText>{title}</FitText></div>;}\n");
  write(root,'src/theme.ts',"export const theme='#123456';");write(root,'resources/paper.png',Buffer.from('paper'));
  const d=doc(root);d.outputs=[{id:'one',path:'src/card.tsx',kind:'scene',durationInFrames:60,props:{title:'First'}},{id:'two',path:'src/card.tsx',kind:'scene',durationInFrames:60,props:{title:'Second'},transparent:true}];
  d.timeline.spine=[{id:'a',assetId:'output:one',srcIn:0,srcOut:2,speed:1,audio:{mute:true},reason:'Card'},{id:'b',assetId:'output:two',srcIn:0,srcOut:2,speed:1,audio:{mute:true},reason:'Card'}];writeFileSync(join(root,'Workspace/project.json'),JSON.stringify(d));
  const {publication}=await publish(ws,'p1');expect(publication.assets).toHaveLength(2);
  const scenes=db.footage().assets.filter(a=>a.scene);expect(scenes).toHaveLength(2);
  for(const asset of scenes){expect(asset.scene).toMatchObject({format:'engine',durationInFrames:60,engine:{version:1,chunks:['core']}});expect(asset).toMatchObject({width:1920,height:1080,fps:30});expect(asset.originalPath.endsWith('scene.js')).toBe(true);
   const resources=JSON.parse(readFileSync(join(dirname(asset.originalPath),'resources.json'),'utf8')).files;expect(Object.keys(resources)).toEqual(['paper.png']);expect(existsSync(join(root,'Media/Engine/files',resources['paper.png']))).toBe(true);expect(existsSync(asset.originalPath+'.map')).toBe(true);}
  expect(scenes.map(a=>a.scene!.engine!.props)).toEqual([{title:'First'},{title:'Second'}]);expect(scenes[1].scene!.engine!.transparent).toBe(true);expect(scenes[0].id).not.toBe(scenes[1].id);
  // Editing a helper the scene imports and publishing again refreshes the scene on the timeline.
  const before=db.timeline().spine.map(c=>c.assetId);write(root,'src/theme.ts',"export const theme='#654321';");
  const {publication:second}=await publish(ws,'p2');expect(second.refreshed).toHaveLength(2);const after=db.timeline().spine.map(c=>c.assetId);expect(after[0]).not.toBe(before[0]);
  expect(readFileSync(db.footage().assets.find(a=>a.id===after[0])!.originalPath,'utf8')).toContain('#654321');
  expect(db.footage().assets.find(a=>a.id===after[0])!.scene!.engine!.props).toEqual({title:'First'});
 }finally{db.close();}
});

it('refuses to publish a scene that does not compile and keeps the published revision',async()=>{
 const {root,db,ws}=fixture();try{await ws.initialize();const head=db.head();
  write(root,'src/broken.tsx',"export default function Broken(){ return <div>{</div>; }");
  const d=doc(root);d.outputs=[{id:'b',path:'src/broken.tsx',kind:'scene',durationInFrames:30}];d.timeline.spine=[{id:'x',assetId:'output:b',srcIn:0,srcOut:1,speed:1,audio:{mute:true},reason:'Broken'}];writeFileSync(join(root,'Workspace/project.json'),JSON.stringify(d));
  await expect(publish(ws,'p1')).rejects.toThrow(/src\/broken\.tsx:1:\d+/);expect(db.head()).toBe(head);
 }finally{db.close();}
});

it('checks scene code on write, previews drafts without publishing, and refuses to finish while a changed scene reports errors',async()=>{
 const {codeAgent}=await import('../../packages/orchestrator/src/code-agent');const {recordSceneError}=await import('../../apps/project-service/src/scene-errors');
 const root=mkdtempSync(join(tmpdir(),'dream-engine-errors-')),db=new ProjectDB(root,'Errors'),events:{type:string;payload:any}[]=[];
 const ws=new CodeWorkspace(db,{run:async()=>{throw Error('No command expected');},ffmpeg:'unavailable',ffprobe:'unavailable'},(type,payload)=>events.push({type,payload}));
 try{await ws.initialize();db.setMeta('pending_request',JSON.stringify({text:'Make a scene',turnId:'turn'}));const signal=new AbortController().signal;
  const broken=await ws.execute('write_file',{path:'src/intro.tsx',content:"export default function Intro(){ return <div>{</div>; }"},'w1','turn',signal);expect(broken.check.errors[0]).toMatchObject({file:'src/intro.tsx',line:1});
  const fixed=await ws.execute('write_file',{path:'src/intro.tsx',content:"import {useCurrentFrame} from 'remotion';\nexport default function Intro(){\n const f=useCurrentFrame();\n if(f>10)throw new Error('frame-limit');\n return <div>{f}</div>;\n}\n"},'w2','turn',signal);expect(fixed.check).toEqual({compiles:true});
  const checked=await ws.execute('check_outputs',{paths:['src/intro.tsx']},'c1','turn',signal,{writes:['src/'],canPublish:false,parent:'worker:call:intro'});
  expect(checked.checked[0]).toMatchObject({compiles:true});const draft=events.find(e=>e.type==='scene.draft')!.payload;expect(draft.hash).toBe(checked.checked[0].preview);expect(existsSync(draft.source.bundlePath)).toBe(true);
  expect(db.turnActivity('turn')!.events!.find(e=>e.id==='draft:c1')).toMatchObject({parent:'worker:call:intro',drafts:[expect.objectContaining({hash:draft.hash,width:1920})]});expect(db.head()).toBe(db.getMeta('turn_start_version'));
  // A draft that fails while previewing is reported with the authored line and reaches the agent's context.
  const bundle=readFileSync(draft.source.bundlePath,'utf8').split('\n'),line=bundle.findIndex(l=>l.includes('frame-limit'))+1;
  await recordSceneError(db,{draft:draft.hash,message:'frame-limit',stack:`Error: frame-limit\n    at Intro (dream-engine://app/draft/${draft.hash}/bundle.js:${line}:${bundle[line-1].indexOf('throw')+1})`});
  expect((ws.currentContext() as any).sceneErrors).toEqual([expect.objectContaining({message:'frame-limit',location:expect.stringMatching(/^src\/intro\.tsx:4:/)})]);
  // Publish the scene; an error reported for the published revision blocks completion until it is fixed.
  const d=doc(root);d.outputs=[{id:'intro',path:'src/intro.tsx',kind:'scene',durationInFrames:30}];d.timeline.spine=[{id:'i',assetId:'output:intro',srcIn:0,srcOut:1,speed:1,audio:{mute:true},reason:'Intro'}];writeFileSync(join(root,'Workspace/project.json'),JSON.stringify(d));
  db.setMeta('turn-drafts:turn','{}');let n=0;
  const result=await codeAgent({db,workspace:ws,turnId:'turn',model:'fixture',text:'Finish',signal,publish:()=>{},infer:async(_m,_s,messages)=>{n++;
   if(n===2){const scene=db.footage().assets.find(a=>a.scene&&db.timeline().spine.some(c=>c.assetId===a.id))!;await recordSceneError(db,{assetId:scene.id,revisionId:scene.scene!.revisionId,message:'frame-limit'});}
   const last=JSON.stringify(messages);
   return{content:[n===1?{type:'tool_use',id:'p1',name:'publish_project',input:{}}:n===2?{type:'tool_use',id:'f1',name:'finish',input:{status:'complete',summary:'Done.',evidence:[]}}:last.includes('reported errors while playing')?{type:'tool_use',id:'f2',name:'finish',input:{status:'blocked',summary:'The intro fails after frame 10.',nextAction:'Fix the frame limit.',evidence:[]}}:{type:'text',text:'unexpected '+last.slice(0,300)}],stop_reason:'tool_use',usage:{}};}});
  expect(result.outcome).toMatchObject({status:'blocked'});expect(n).toBe(3);
 }finally{db.close();}
});

// Publishing empties outputs in project.json, so a draft of a published scene got no props and failed on data it never
// had; the agent then chased that error for dozens of steps, and a draft of a scene it had taken out still blocked finishing.
it('drafts a published scene with its props, and only drafts of scenes in the edit block finishing',async()=>{
 const {recordSceneError}=await import('../../apps/project-service/src/scene-errors');
 const root=mkdtempSync(join(tmpdir(),'dream-engine-drafts-')),db=new ProjectDB(root,'Drafts'),events:{type:string;payload:any}[]=[];
 const ws=new CodeWorkspace(db,{run:async()=>{throw Error('No command expected');},ffmpeg:'unavailable',ffprobe:'unavailable'},(type,payload)=>events.push({type,payload}));
 try{await ws.initialize();db.setMeta('pending_request',JSON.stringify({text:'Captions',turnId:'turn'}));const signal=new AbortController().signal;
  write(root,'src/caps.tsx',"export default function Caps({chunks}:{chunks:string[]}){ return <div>{chunks.join(' ')}</div>; }\n");
  write(root,'src/old.tsx',"export default function Old(){ return <div>old</div>; }\n");
  const d=doc(root);d.outputs=[{id:'caps',path:'src/caps.tsx',kind:'scene',durationInFrames:30,transparent:true,props:{chunks:['hello']}}];d.timeline.spine=[{id:'i',assetId:'output:caps',srcIn:0,srcOut:1,speed:1,audio:{mute:true},reason:'Captions'}];writeFileSync(join(root,'Workspace/project.json'),JSON.stringify(d));
  await ws.execute('publish_project',{},'p1','turn',signal);expect(doc(root).outputs).toEqual([]);
  await ws.execute('check_outputs',{paths:['src/caps.tsx','src/old.tsx']},'c1','turn',signal);
  const drafts=events.filter(e=>e.type==='scene.draft').map(e=>e.payload),caps=drafts.find(p=>p.source.config.props)!,old=drafts.find(p=>p!==caps)!;
  expect(caps.source.config).toMatchObject({props:{chunks:['hello']},transparent:true,durationInFrames:30});
  await recordSceneError(db,{draft:caps.hash,message:'caps-broke'});await recordSceneError(db,{draft:old.hash,message:'old-broke'});
  // The agent still hears about both; finishing waits only on the scene that is in the edit.
  expect(ws.sceneErrors('turn').map(e=>e.message).sort()).toEqual(['caps-broke','old-broke']);
  expect(ws.sceneErrors('turn',{inEdit:true}).map(e=>e.message)).toEqual(['caps-broke']);
 }finally{db.close();}
});
