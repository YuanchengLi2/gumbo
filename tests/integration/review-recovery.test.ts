import {it,expect} from 'vitest';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ProjectDB} from '@dream/project-db';
import {AssetSchema} from '@dream/footage';
import {ClipSchema} from '@dream/timeline';
import {Director} from '../../packages/orchestrator/src/legacy-director';

it('resumes an interrupted visual-review repair without repeating the edit and keeps one undoable action',async()=>{
 const db=new ProjectDB(mkdtempSync(join(tmpdir(),'dream-review-')),'Review');
 try{
  db.saveAsset(AssetSchema.parse({id:'a',kind:'video',filename:'a.mp4',originalPath:'a.mp4',durationSec:6,fingerprint:'f'}));
  db.apply([{type:'insert_clip',position:0,clip:ClipSchema.parse({id:'c',assetId:'a',srcIn:0,srcOut:6,reason:'Fixture'}),reason:'Fixture'}],'Fixture','fixture',db.head());
  let frames=0,calls=0;
  const director=new Director(db,async()=>({url:'unused',token:'unused'}),()=>{},async request=>{frames+=request.frames.length;return{versionId:request.versionId,frames:request.frames.map(f=>({...f,mimeType:'image/jpeg',data:'dGVzdA==',sha256:'a'.repeat(64)}))};});
  director.inference=async(_model,_system,messages)=>{
   calls++;if(calls===4)throw new Error('Connection interrupted after committed repair');
   let name='report',input:any={summary:'Saved',status:'complete',evidence:[{toolCallId:calls===1?'initial-read':'tool-3',finding:'Current edit inspected or repaired.'}]},id=`tool-${calls}`;
   if(calls===2||calls===6){expect(JSON.stringify(messages)).toContain('"type":"image"');name='submit_review';input={summary:'Reviewed rendered evidence',issues:calls===2?[{severity:'repair',itemIds:['c'],frame:0,problem:'Opening holds too long',recommendation:'Trim to 3 seconds'}]:[]};}
   if(calls===3){name='apply_ops';input={label:'Tighten opening',ops:[{type:'trim_clip',clipId:'c',srcIn:0,srcOut:3,reason:'Review repair'}]};}
   return{content:[...(calls===1?[{type:'tool_use',id:'initial-read',name:'get_project',input:{}}]:[]),{type:'tool_use',id,name,input}],stop_reason:'tool_use',usage:{}};
  };
  await expect(director.edit('A concise opening','turn',[],true)).rejects.toThrow('Connection interrupted');
  const versionCount=db.state().versions.length;expect(db.timeline().spine[0].srcOut).toBe(3);
  await director.edit('A concise opening','turn',[],true);
  expect(calls).toBe(6);expect(frames).toBeGreaterThan(2);expect(db.state().versions).toHaveLength(versionCount);
  expect(JSON.parse(db.getMeta('review:turn')!).done).toBe(true);expect(Number(db.getMeta('tool_count:turn'))).toBe(4);
  expect(db.state().messages.filter(m=>(m.report as any)?.review)).toHaveLength(2);
  db.undo();expect(db.timeline().spine[0].srcOut).toBe(6);
 }finally{db.close();}
});
