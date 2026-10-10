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
