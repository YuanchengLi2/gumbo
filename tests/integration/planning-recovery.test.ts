import {it,expect} from 'vitest';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ProjectDB} from '@dream/project-db';
import {AssetSchema} from '@dream/footage';
import {Director} from '../../packages/orchestrator/src/legacy-director';

it('resumes a read-only outline search from its saved context without editing before approval',async()=>{
 const db=new ProjectDB(mkdtempSync(join(tmpdir(),'dream-outline-')),'Outline');
 try{
  db.saveAsset(AssetSchema.parse({id:'a',filename:'talk.mp4',kind:'video',durationSec:7200,originalPath:'C:/private/talk.mp4',fingerprint:'f'}));
  db.saveRecords('words',[{id:'w',assetId:'a',text:'launch',start:7000,end:7001,confidence:1,speaker:'unknown',pauseBefore:0}]);
  let calls=0;const director=new Director(db,async()=>({url:'unused',token:'unused'}),()=>{});
  director.inference=async(_model,_system,messages)=>{
   calls++;if(calls===2)throw new Error('Connection lost');
   if(calls===3){expect(JSON.stringify(messages)).toContain('"tool_use_id":"read"');expect(JSON.stringify(messages)).toContain('7000');expect(JSON.stringify(messages)).not.toContain('C:/private');}
   return{content:calls===1?[{type:'tool_use',id:'read',name:'read_footage',input:{assetId:'a',startSec:6999,endSec:7010}}]:[{type:'tool_use',id:'outline',name:'submit_outline',input:{goal:'Late-source launch',targetDurationSec:1,beats:[{id:'intro',purpose:'Launch',targetSec:1,sources:[{assetId:'a',srcIn:7000,srcOut:7001}]}]}}],stop_reason:'tool_use',usage:{}};
  };
  await expect(director.outline('Use the launch at the end','turn')).rejects.toThrow('Connection lost');
  await director.outline('Use the launch at the end','turn');
  expect(calls).toBe(3);expect(db.timeline().spine).toHaveLength(0);expect(db.state().aiStatus).toBe('awaiting_approval');expect(JSON.parse(db.getMeta('outline')!).beats[0].sources[0].srcIn).toBe(7000);
  expect(JSON.parse(db.getMeta('outline_checkpoint:turn')!).reads).toBe(1);
 }finally{db.close();}
});
