import {it,expect,describe} from 'vitest';
import {mkdtempSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';
import ffmpeg from 'ffmpeg-static';
import ffprobe from 'ffprobe-static';
import {ProjectDB} from '@dream/project-db';
import {sampleTimes,boxFrom,smoothPath,followKeyframes,parseBoxes,locator} from '../../apps/project-service/src/track';
import {Workspace} from '../../apps/project-service/src/workspace';
import {call,textOf} from '../fixtures/agent-project';

describe('following a subject',()=>{
 it('looks twice a second, and at most 240 times over a long range',()=>{
  expect(sampleTimes(10,12)).toEqual([10,10.5,11,11.5,12]);
  expect(sampleTimes(0,3600).length).toBeLessThanOrEqual(241);
 });
 it('reads boxes as Gemini gives them, and the reply as one per frame',()=>{
  expect(boxFrom([100,200,500,400])).toEqual({x:expect.closeTo(.3),y:expect.closeTo(.3),w:expect.closeTo(.2),h:expect.closeTo(.4)});
  expect(boxFrom(null)).toBeNull();expect(boxFrom([1,2,3])).toBeNull();
  expect(parseBoxes('```json\n[{"frame":1,"box":[0,0,500,500]},{"frame":3,"box":null}]\n```',3)).toEqual([[0,0,500,500],null,null]);
 });
 it('drops a misread, fills what was not seen, and glides',()=>{
  const at=(i:number)=>i*.5,samples=[0,1,2,3,4,5,6,7].map(i=>({at:at(i),box:i===3?{x:.95,y:.9,w:.1,h:.2}:i===5?null:{x:.2+i*.05,y:.5,w:.1,h:.2}}));
  const path=smoothPath(samples);
  expect(path).toHaveLength(8);expect(Math.max(...path.map(p=>p.x))).toBeLessThan(.6);
  expect(path[5].x).toBeGreaterThan(path[4].x);expect(path[5].x).toBeLessThan(path[6].x);
  expect(smoothPath([{at:0,box:null}])).toEqual([]);
 });
 it('keeps the subject centred in a vertical frame of wide footage, never past the picture edge',()=>{
  const path=[{at:0,x:.75,y:.5,w:.1,h:.3},{at:1,x:.75,y:.5,w:.1,h:.3},{at:2,x:.99,y:.5,w:.1,h:.3}];
  const keys=followKeyframes(path,{width:1920,height:1080},{width:9000,height:16000});
  // Filling a 9:16 frame, the 16:9 picture is 3.16 frame widths wide: a subject a quarter from the right is moved left by
  // 0.25 × 3.16 frame widths; at the very right edge the picture stops at the frame's edge.
  expect(keys[0]).toEqual({sec:0,scale:1,x:expect.closeTo(.5-.25*16/9*16/9,2),y:.5});
  expect(keys.at(-1)!.x).toBeCloseTo(.5-(16/9*16/9-1)/2,2);
 });
});

// A white square moving left to right over two seconds of black; the stand-in model "finds" it from the frame times.
it('follows a subject with the track tool: the path file, keyframes, and frames to check it by',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'gumbo-track-')),db=new ProjectDB(folder,'Track'),video=join(folder,'square.mp4');
 const made=spawnSync(ffmpeg!,['-v','error','-y','-f','lavfi','-i','color=c=black:s=320x180:d=2:r=30','-vf',"drawbox=x='20+t*120':y=70:w=40:h=40:c=white:t=fill",'-c:v','libx264','-pix_fmt','yuv420p',video],{encoding:'utf8'});
 if(made.status!==0)throw new Error(made.stderr);
 db.saveAsset({id:'v1',filename:'square.mp4',kind:'video',durationSec:2,fps:30,width:320,height:180,hasAudio:false,originalPath:video,fingerprint:'f1',status:'ready'} as any);
 const asked:string[]=[];
 const locate=locator(async content=>{const frames=(content as any[]).filter(c=>c.type==='text'&&/^Frame/.test(c.text)).map(c=>Number(/\(([\d.]+) s\)/.exec(c.text)![1]));asked.push((content[0] as any).text);
  return JSON.stringify(frames.map((t,i)=>({frame:i+1,box:[389,Math.round((20+t*120)/320*1000),611,Math.round((60+t*120)/320*1000)]})));});
 const workspace=new Workspace(db,{run:async()=>{throw new Error('no commands');},ffmpeg:ffmpeg!,ffprobe:ffprobe.path,locate},()=>{});
 try{
  await workspace.initialize();
  const result:any=await call(workspace,'track',{source:'v1',start:0,end:2,subject:'the white square',frame:'9:16'},'t1');
  expect(asked).toEqual(['The subject: the white square. 5 frames.']);
  const text=textOf(result);
  expect(text).toContain('Followed "the white square" in square.mp4 from 0 to 2 s: marked in 5 of 5 frames.');
  expect(text).toContain('Saved output/tracks/the-white-square.json');expect(text).toMatch(/Keyframes for a 9:16 frame at zoom 1/);
  expect(result.content.filter((c:any)=>c.type==='image')).toHaveLength(3);
  const track=JSON.parse(readFileSync(join(folder,'Workspace','output','tracks','the-white-square.json'),'utf8'));
  expect(track.path.map((p:any)=>p.x)).toEqual([...track.path.map((p:any)=>p.x)].sort((a:number,b:number)=>a-b));
  expect(track.keyframes[0].sec).toBe(0);expect(track.keyframes.at(-1).x).toBeLessThan(track.keyframes[0].x);
 }finally{workspace.close();db.close();}
},60_000);
