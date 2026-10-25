import {it,expect} from 'vitest';
import {mkdtempSync,readFileSync,writeFileSync,existsSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {ProjectDB} from '@dream/project-db';
import {Workspace} from '../../apps/project-service/src/workspace';
import {recordSceneError} from '../../apps/project-service/src/scene-errors';
import {call,textOf} from '../fixtures/agent-project';

const fixture=()=>{const root=mkdtempSync(join(tmpdir(),'dream-engine-pub-')),db=new ProjectDB(root,'Engine'),events:{type:string;payload:any}[]=[];const ws=new Workspace(db,{run:async()=>{throw Error('No command expected');},ffmpeg:'unavailable',ffprobe:'unavailable'},(type,payload)=>events.push({type,payload}));return{root,db,ws,events};};
const write=(root:string,path:string,text:string|Buffer)=>{const target=join(root,'Workspace',path);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,text);};
const doc=(root:string)=>JSON.parse(readFileSync(join(root,'Workspace/project.json'),'utf8'));
/** Writing project.json applies it, as Roux's write does; the receipt says what that made. */
const apply=async(ws:Workspace,db:ProjectDB,document:unknown,id:string)=>{const text=textOf(await call(ws,'write',{path:'project.json',content:JSON.stringify(document,null,2)},id));const row=db.db.prepare('SELECT json FROM workspace_publications WHERE id=?').get(id) as {json:string}|undefined;return{text,publication:row?JSON.parse(row.json):undefined};};

it('applies a TSX scene as an engine asset with its resources, at the project frame size, from one component with props',async()=>{
 const {root,db,ws}=fixture();try{await ws.initialize();
  write(root,'src/card.tsx',"import {useCurrentFrame} from 'remotion';\nimport {FitText,resource} from '@dream/engine';\nimport {theme} from './theme';\nexport default function Card({title}:{title:string}){useCurrentFrame();return <div style={{background:theme,backgroundImage:`url(${resource('paper.png')})`}}><FitText>{title}</FitText></div>;}\n");
  write(root,'src/theme.ts',"export const theme='#123456';");write(root,'resources/paper.png',Buffer.from('paper'));
  const d=doc(root);d.outputs=[{id:'one',path:'src/card.tsx',kind:'scene',durationInFrames:60,props:{title:'First'}},{id:'two',path:'src/card.tsx',kind:'scene',durationInFrames:60,props:{title:'Second'},transparent:true}];
  d.timeline.spine=[{id:'a',assetId:'output:one',srcIn:0,srcOut:2,speed:1,audio:{mute:true},reason:'Card'},{id:'b',assetId:'output:two',srcIn:0,srcOut:2,speed:1,audio:{mute:true},reason:'Card'}];
  const {text,publication}=await apply(ws,db,d,'p1');expect(publication.assets).toHaveLength(2);expect(text).toMatch(/output:one is now code_/);
  const scenes=db.footage().assets.filter(a=>a.scene);expect(scenes).toHaveLength(2);
  for(const asset of scenes){expect(asset.scene).toMatchObject({format:'engine',durationInFrames:60,engine:{version:1,chunks:['core']}});expect(asset).toMatchObject({width:1920,height:1080,fps:30});expect(asset.originalPath.endsWith('scene.js')).toBe(true);
   const resources=JSON.parse(readFileSync(join(dirname(asset.originalPath),'resources.json'),'utf8')).files;expect(Object.keys(resources)).toEqual(['paper.png']);expect(existsSync(join(root,'Media/Engine/files',resources['paper.png']))).toBe(true);expect(existsSync(asset.originalPath+'.map')).toBe(true);}
  expect(scenes.map(a=>a.scene!.engine!.props)).toEqual([{title:'First'},{title:'Second'}]);expect(scenes[1].scene!.engine!.transparent).toBe(true);expect(scenes[0].id).not.toBe(scenes[1].id);
  // Writing a helper the scene imports updates the scenes in the edit at once.
  const before=db.timeline().spine.map(c=>c.assetId);
  expect(textOf(await call(ws,'write',{path:'src/theme.ts',content:"export const theme='#654321';"},'w2'))).toMatch(/Applied/);
  const after=db.timeline().spine.map(c=>c.assetId);expect(after[0]).not.toBe(before[0]);
  expect(readFileSync(db.footage().assets.find(a=>a.id===after[0])!.originalPath,'utf8')).toContain('#654321');
  expect(db.footage().assets.find(a=>a.id===after[0])!.scene!.engine!.props).toEqual({title:'First'});
 }finally{ws.close();db.close();}
});

it('refuses to apply a scene that does not compile, says where, and keeps the edit as it was',async()=>{
 const {root,db,ws}=fixture();try{await ws.initialize();const head=db.head();
  write(root,'src/broken.tsx',"export default function Broken(){ return <div>{</div>; }");
  const d=doc(root);d.outputs=[{id:'b',path:'src/broken.tsx',kind:'scene',durationInFrames:30}];d.timeline.spine=[{id:'x',assetId:'output:b',srcIn:0,srcOut:1,speed:1,audio:{mute:true},reason:'Broken'}];
  await expect(apply(ws,db,d,'p1')).rejects.toThrow(/Not applied[\s\S]*src\/broken\.tsx:1:\d+/);expect(db.head()).toBe(head);
 }finally{ws.close();db.close();}
});

it('checks scene code when written, previews a scene not in the edit, and tells the next message about a scene that crashed',async()=>{
 const {root,db,ws,events}=fixture();
 try{await ws.initialize();db.setMeta('pending_request',JSON.stringify({text:'Make a scene',turnId:'turn'}));
  const broken=textOf(await call(ws,'write',{path:'src/intro.tsx',content:"export default function Intro(){ return <div>{</div>; }"},'w1'));expect(broken).toMatch(/does not compile/);expect(broken).toMatch(/src\/intro\.tsx:1:/);
  const fixed=textOf(await call(ws,'write',{path:'src/intro.tsx',content:"import {useCurrentFrame} from 'remotion';\nexport default function Intro(){\n const f=useCurrentFrame();\n if(f>10)throw new Error('frame-limit');\n return <div>{f}</div>;\n}\n"},'w2'));
  expect(fixed).toMatch(/compiles; the user sees a preview/);
  const draft=events.find(e=>e.type==='scene.draft')!.payload;expect(existsSync(draft.source.bundlePath)).toBe(true);
  expect(db.turnActivity('turn')!.events!.find(e=>e.id==='draft:w2')).toMatchObject({drafts:[expect.objectContaining({hash:draft.hash,width:1920})]});
  // A draft that fails while previewing is reported with the authored line.
  const bundle=readFileSync(draft.source.bundlePath,'utf8').split('\n'),line=bundle.findIndex(l=>l.includes('frame-limit'))+1;
  await recordSceneError(db,{draft:draft.hash,message:'frame-limit',stack:`Error: frame-limit\n    at Intro (dream-engine://app/draft/${draft.hash}/bundle.js:${line}:${bundle[line-1].indexOf('throw')+1})`});
  expect(ws.sceneErrors('turn')).toEqual([expect.objectContaining({message:'frame-limit',location:expect.stringMatching(/^src\/intro\.tsx:4:/)})]);
  // Placed in the edit, the scene crashes while the user watches; the next message hears of it with the code at the line.
  const d=doc(root);d.outputs=[{id:'intro',path:'src/intro.tsx',kind:'scene',durationInFrames:30}];d.timeline.spine=[{id:'i',assetId:'output:intro',srcIn:0,srcOut:1,speed:1,audio:{mute:true},reason:'Intro'}];
  await apply(ws,db,d,'p1');const scene=db.footage().assets.find(a=>a.scene&&db.timeline().spine.some(c=>c.assetId===a.id))!;
  await recordSceneError(db,{assetId:scene.id,revisionId:scene.scene!.revisionId,message:'frame-limit'});
  const context=ws.messageContext({turnId:'next',text:'Is it fine?',selection:[],assetIds:[],known:[]}).text;
  expect(context).toMatch(/reported errors while playing/);expect(context).toMatch(/frame-limit/);
 }finally{ws.close();db.close();}
});

it('updates a scene already in the edit when its file is written again, with its props',async()=>{
 const {root,db,ws,events}=fixture();
 try{await ws.initialize();
  write(root,'src/caps.tsx',"export default function Caps({chunks}:{chunks:string[]}){ return <div>{chunks.join(' ')}</div>; }\n");
  const d=doc(root);d.outputs=[{id:'caps',path:'src/caps.tsx',kind:'scene',durationInFrames:30,transparent:true,props:{chunks:['hello']}}];d.timeline.spine=[{id:'i',assetId:'output:caps',srcIn:0,srcOut:1,speed:1,audio:{mute:true},reason:'Captions'}];
  await apply(ws,db,d,'p1');expect(doc(root).outputs).toEqual([]);const first=db.timeline().spine[0].assetId;
  expect(textOf(await call(ws,'write',{path:'src/caps.tsx',content:"export default function Caps({chunks}:{chunks:string[]}){ return <b>{chunks.join(' ')}</b>; }\n"},'w1'))).toMatch(/Applied/);
  const now=db.timeline().spine[0].assetId,asset=db.footage().assets.find(a=>a.id===now)!;
  expect(now).not.toBe(first);expect(asset.scene!.engine).toMatchObject({props:{chunks:['hello']},transparent:true});
  // In the edit, it is updated rather than drafted.
  expect(events.filter(e=>e.type==='scene.draft')).toHaveLength(0);
  // A later change can place output:caps again by its name: it names what the earlier write made.
  const again=doc(root);again.timeline.spine.push({id:'j',assetId:'output:caps',srcIn:0,srcOut:1,speed:1,audio:{mute:true},reason:'Again'});
  await apply(ws,db,again,'p2');expect(db.timeline().spine.map(c=>c.assetId)).toEqual([now,now]);
 }finally{ws.close();db.close();}
});
