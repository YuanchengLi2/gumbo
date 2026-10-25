import {it,expect} from 'vitest';
import {mkdtempSync,readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {ProjectDB} from '@dream/project-db';
import {publishWorkspace} from '../../apps/project-service/src/code-publication';
import {inProcessRenderer,type AudioRenderer} from '../../apps/project-service/src/sound-outputs';
import {Workspace} from '../../apps/project-service/src/workspace';
import {sceneFromAsset} from '../../apps/desktop/src/main/engine-routes';
import type {ProcessResult} from '@dream/contracts';

const result=(id:string):ProcessResult=>({id,status:'complete',exitCode:0,startedAt:'x',finishedAt:'x',output:'',logPath:'',isolation:'windows-appcontainer',commandHash:id});
const score={title:'Pulse',tempo:120,key:'D major',sections:[{name:'main',bars:2}],tracks:[{instrument:'kick',pattern:'x...x...x...x...'},{instrument:'pad',chords:['D','G']}]};

it('publishes a score as an audio asset with beats, caches it, binds it on the timeline and gives scenes its beats',async()=>{
 const root=mkdtempSync(join(tmpdir(),'dream-music-')),db=new ProjectDB(root,'Music');const ws=new Workspace(db,{run:async()=>{throw Error('x');},ffmpeg:'',ffprobe:''},()=>{});
 let renders=0;const counting:AudioRenderer=async(input,signal)=>{renders++;return inProcessRenderer(input,signal);};
 try{await ws.initialize();const write=(path:string,text:string)=>{mkdirSync(dirname(join(root,'Workspace',path)),{recursive:true});writeFileSync(join(root,'Workspace',path),text);};
  write('src/music/pulse.score.json',JSON.stringify(score));write('src/scene.tsx',"import {useBeats} from '@dream/engine';export default()=>{const b=useBeats('pulse');return <div style={{opacity:b.pulse()}}/>;};");
  const doc=JSON.parse(readFileSync(join(root,'Workspace/project.json'),'utf8'));
  doc.outputs=[{id:'beat',path:'src/scene.tsx',kind:'scene',durationInFrames:60,music:['pulse']},{id:'pulse',path:'src/music/pulse.score.json',kind:'music'},{id:'whoosh',path:'preset:Soft whoosh',kind:'sfx'}];
  doc.timeline.spine=[{id:'s',assetId:'output:beat',srcIn:0,srcOut:2,speed:1,audio:{mute:true},reason:'Beat scene'}];
  doc.timeline.music=[{id:'m',assetId:'output:pulse',srcIn:0,srcOut:4,start:{kind:'project',at:'start',offsetSec:0},gainDb:0,reason:'Score'}];
  doc.timeline.attached=[{id:'w',type:'sfx',component:'source',source:{assetId:'output:whoosh',srcIn:0,srcOut:.3},start:{kind:'project',at:'start',offsetSec:1},durationSec:.3,layer:1,reason:'Whoosh'}];
  writeFileSync(join(root,'Workspace/project.json'),JSON.stringify(doc));
  const receipt=await publishWorkspace(db,result('p1'),'turn','',{renderAudio:counting});db.workspace.restorePending();expect(receipt?.assets).toHaveLength(3);expect(renders).toBe(2);
  const assets=db.footage().assets,music=assets.find(a=>a.generated?.kind==='score')!,sfx=assets.find(a=>a.generated?.kind==='sfx')!,scene=assets.find(a=>a.scene)!;
  expect(music).toMatchObject({kind:'audio',durationSec:4,hasAudio:true});expect(music.generated!.beats!.slice(0,3)).toEqual([0,.5,1]);expect(existsSync(music.originalPath)).toBe(true);
  expect(sfx.kind).toBe('audio');expect(db.timeline().music[0].assetId).toBe(music.id);expect(db.timeline().attached[0].source!.assetId).toBe(sfx.id);
  expect(scene.scene!.engine!.music).toEqual({pulse:music.id});
  expect(sceneFromAsset(scene,id=>assets.find(a=>a.id===id)?.generated?.beats)!.config.beats!.pulse.slice(0,2)).toEqual([0,.5]);
  // Republishing unchanged sound reuses the rendered audio.
  const again=JSON.parse(readFileSync(join(root,'Workspace/project.json'),'utf8'));again.outputs=[{id:'pulse2',path:'src/music/pulse.score.json',kind:'music'}];again.timeline.music=[...again.timeline.music,{id:'m2',assetId:'output:pulse2',srcIn:0,srcOut:4,start:{kind:'project',at:'start',offsetSec:0},gainDb:-6,reason:'Again'}];writeFileSync(join(root,'Workspace/project.json'),JSON.stringify(again));
  await publishWorkspace(db,result('p2'),'turn','',{renderAudio:counting});expect(renders).toBe(2);
 }finally{db.close();}
});

it('builds sound effects from a sound design file and names the field of an invalid score',async()=>{
 const root=mkdtempSync(join(tmpdir(),'dream-sfx-')),db=new ProjectDB(root,'Sfx');const ws=new Workspace(db,{run:async()=>{throw Error('x');},ffmpeg:'',ffprobe:''},()=>{});
 try{await ws.initialize();mkdirSync(join(root,'Workspace/src/sfx'),{recursive:true});mkdirSync(join(root,'Workspace/src/music'),{recursive:true});
  writeFileSync(join(root,'Workspace/src/sfx/rise.sfx.json'),JSON.stringify({durationSec:.5,layers:[{id:'a',wave:'saw',startSec:0,durationSec:.5,frequencyHz:200,endFrequencyHz:1200,gainDb:-8,pan:0,attackSec:.05,releaseSec:.2,filterHz:4000}]}));
  writeFileSync(join(root,'Workspace/src/music/bad.score.json'),JSON.stringify({tempo:120,tracks:[{instrument:'bass',notes:'A2 Z9'}]}));
  const doc=JSON.parse(readFileSync(join(root,'Workspace/project.json'),'utf8'));doc.outputs=[{id:'rise',path:'src/sfx/rise.sfx.json',kind:'sfx'}];doc.timeline.attached=[{id:'r',type:'sfx',component:'source',source:{assetId:'output:rise',srcIn:0,srcOut:.5},start:{kind:'project',at:'start',offsetSec:0},durationSec:.5,layer:1,reason:'Rise'}];writeFileSync(join(root,'Workspace/project.json'),JSON.stringify(doc));
  await publishWorkspace(db,result('p1'),'turn','');db.workspace.restorePending();expect(db.footage().assets.find(a=>a.generated?.kind==='sfx')).toMatchObject({kind:'audio',durationSec:.5});
  const bad=JSON.parse(readFileSync(join(root,'Workspace/project.json'),'utf8'));bad.outputs=[{id:'bad',path:'src/music/bad.score.json',kind:'music'}];bad.timeline.music=[{id:'b',assetId:'output:bad',srcIn:0,srcOut:1,start:{kind:'project',at:'start',offsetSec:0},gainDb:0,reason:'Bad'}];writeFileSync(join(root,'Workspace/project.json'),JSON.stringify(bad));
  await expect(publishWorkspace(db,result('p2'),'turn','')).rejects.toThrow(/bad\.score\.json.*tracks\[0\]\.notes token 2/);
 }finally{db.close();}
});
