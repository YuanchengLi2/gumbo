import {it,expect} from 'vitest';
import {mkdtempSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {ProjectDB} from '@dream/project-db';
import {CodeWorkspace} from '../../apps/project-service/src/code-workspace';

const fixture=()=>{const root=mkdtempSync(join(tmpdir(),'dream-guidance-')),db=new ProjectDB(root,'Guidance');const ws=new CodeWorkspace(db,{run:async()=>{throw Error('No command expected');},ffmpeg:'',ffprobe:''},()=>{});return{root,db,ws};};
const write=(root:string,path:string,text:string)=>{mkdirSync(dirname(join(root,'Workspace',path)),{recursive:true});writeFileSync(join(root,'Workspace',path),text);};
const signal=new AbortController().signal;

it('publishes the timeline example from the engine reference exactly as written',async()=>{
 const {root,db,ws}=fixture();try{await ws.initialize();
  const reference=readFileSync('packages/scene-engine/reference/api.md','utf8'),block=reference.slice(reference.indexOf('## Timeline items')).match(/```json\r?\n([\s\S]*?)```/)![1];
  const example=JSON.parse(block.replace('"<imported asset id>","srcIn":12.5,"srcOut":18','"output:intro","srcIn":0,"srcOut":3'));
  write(root,'src/intro.tsx',"export default function Intro(){return <div/>;}");write(root,'src/lowerthird.tsx',"export default function LowerThird(){return <div/>;}");
  write(root,'src/music/theme.score.json',JSON.stringify({tempo:120,durationSec:20,tracks:[{instrument:'pad',chords:['C','G']}]}));
  const doc=JSON.parse(readFileSync(join(root,'Workspace/project.json'),'utf8'));
  doc.outputs=[{id:'intro',path:'src/intro.tsx',kind:'scene',durationInFrames:150},{id:'lowerthird',path:'src/lowerthird.tsx',kind:'scene',durationInFrames:120,transparent:true},{id:'whoosh',path:'preset:Soft whoosh',kind:'sfx'},{id:'theme',path:'src/music/theme.score.json',kind:'music'}];
  doc.timeline={...doc.timeline,...example};writeFileSync(join(root,'Workspace/project.json'),JSON.stringify(doc));
  const {publication}=await ws.execute('publish_project',{},'p1','turn',signal);expect(publication.assets).toHaveLength(4);
  expect(db.timeline().attached.map(i=>i.id)).toEqual(['name','whoosh1']);expect(db.timeline().music).toHaveLength(1);
 }finally{db.close();}
});

it('explains invalid timeline items in plain lines instead of raw validator output',async()=>{
 const {root,db,ws}=fixture();try{await ws.initialize();
  const doc=JSON.parse(readFileSync(join(root,'Workspace/project.json'),'utf8'));
  doc.timeline.attached=[{id:'sfx4',type:'sfx',start:{kind:'project',at:4},source:{assetId:'x',srcIn:0,srcOut:1}}];writeFileSync(join(root,'Workspace/project.json'),JSON.stringify(doc));
  const failure=await ws.execute('publish_project',{},'p1','turn',signal).then(()=>'',error=>String((error as Error).message));
  expect(failure).toContain('timeline.attached[0].component: required');expect(failure).toContain('timeline.attached[0].start.at: must be one of "start", "end"');expect(failure).not.toContain('"code"');
  doc.timeline.attached=[{id:'sfx4',type:'sfx',component:'source',start:{kind:'project',at:'start',offsetSec:4}}];writeFileSync(join(root,'Workspace/project.json'),JSON.stringify(doc));
  expect(await ws.execute('publish_project',{},'p2','turn',signal).then(()=>'',error=>String((error as Error).message))).toContain('sfx4: has no length; give it durationSec');
 }finally{db.close();}
});

it('checks score files without rendering: bars, sections, loop lengths and drifting tracks',async()=>{
 const {root,db,ws}=fixture();try{await ws.initialize();
  write(root,'src/music/bounce.score.json',JSON.stringify({tempo:120,sections:[{name:'intro',bars:2},{name:'main',bars:4}],tracks:[{instrument:'kick',pattern:'x...x...x...x...'},{instrument:'lead',notes:'C4:8n E4 G4'}]}));
  write(root,'src/music/broken.score.json',JSON.stringify({tempo:120,tracks:[{instrument:'bass',notes:'A2 Q2'}]}));
  const {checked}=await ws.execute('check_outputs',{paths:['src/music/bounce.score.json','src/music/broken.score.json']},'c1','turn',signal);
  expect(checked[0].score).toMatchObject({tempo:120,meter:'4/4',bars:6,durationSec:12,sections:[{name:'intro',bars:2},{name:'main',bars:4}]});
  expect(checked[0].score.tracks[0]).toMatchObject({instrument:'kick',loopBars:1});expect(checked[0].score.tracks[1]).toMatchObject({instrument:'lead',loopBars:.375});
  expect(checked[0].score.warnings).toEqual([expect.stringContaining('tracks[1] (lead) loops every 0.375 bars')]);
  expect(checked[1].errors[0]).toContain('tracks[0].notes token 2');
 }finally{db.close();}
});

it('replaces the workspace guide of projects from before the scene engine',async()=>{
 const {root,db,ws}=fixture();try{mkdirSync(join(root,'Workspace'),{recursive:true});writeFileSync(join(root,'Workspace/README.md'),'Old guide. See context/live-scenes.md.');
  await ws.initialize();const readme=readFileSync(join(root,'Workspace/README.md'),'utf8');expect(readme).not.toContain('live-scenes');expect(readme).toContain('scene engine');
 }finally{db.close();}
});

it('keeps the project timeline identity when a rewritten project.json carries a made-up timeline id',async()=>{
 const {root,db,ws}=fixture();try{await ws.initialize();const id=db.timeline().id;
  const doc=JSON.parse(readFileSync(join(root,'Workspace/project.json'),'utf8'));doc.timeline={...doc.timeline,id:'my-edit',settings:{...doc.timeline.settings,fps:24}};writeFileSync(join(root,'Workspace/project.json'),JSON.stringify(doc));
  await ws.execute('publish_project',{},'p1','turn',signal);expect(db.timeline().id).toBe(id);expect(db.timeline().settings.fps).toBe(24);
 }finally{db.close();}
});
