import {it,expect} from 'vitest';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProjectDB} from '@dream/project-db';
import {codeAgent} from '../../packages/orchestrator/src/code-agent';
import {trackRepeat,withReminder,type Repeat} from '../../packages/orchestrator/src/repeat-reminder';

/** Repeat reminders (repeat-reminder.ts): the exact same call several times in a row gets advice with its result, never a block. */
it('reminds at the third, fifth and eighth identical call in a row, and a different call starts again',()=>{
 let repeat:Repeat|undefined;const reminded:number[]=[];
 for(let n=1;n<=9;n++){const next=trackRepeat(repeat,'view_media','same');repeat=next.repeat;if(next.reminder)reminded.push(n);}
 expect(reminded).toEqual([3,5,8]);
 expect(trackRepeat(repeat,'view_media','other').repeat).toEqual({key:'other',count:1});
 // Task updates neither count nor break a run of repeats.
 expect(trackRepeat({key:'same',count:2},'update_tasks','tasks')).toEqual({repeat:{key:'same',count:2}});
 expect(withReminder('result','Reminder.')).toBe('result\n\nReminder.');
 expect(withReminder([{type:'image'}],'Reminder.')).toEqual([{type:'image'},{type:'text',text:'Reminder.'}]);
});

it('sends the reminder with the repeated result in a run, and a new call clears it',async()=>{
 const db=new ProjectDB(mkdtempSync(join(tmpdir(),'dream-repeat-')));let calls=0;const results:string[]=[];
 try{db.setMeta('pending_request',JSON.stringify({turnId:'turn'}));
  const result=await codeAgent({db,workspace:{initialize:async()=>{},context:()=>({}),execute:async()=>({text:'the same transcript'})},turnId:'turn',text:'What is said in the video?',model:'fixture',readOnly:true,signal:new AbortController().signal,publish:()=>{},infer:async(_model,_system,messages)=>{
   const n=calls++;if(n)results.push(JSON.stringify((messages as any[]).at(-1)));
   // Three identical reads, a different one, then the first again: only the third carries the reminder.
   const input=n===3?{assetId:'music'}:{assetId:'voice'};
   return{content:[n<5?{type:'tool_use',id:'read'+n,name:'read_transcript',input}:{type:'tool_use',id:'done',name:'finish',input:{status:'complete',summary:'Said.',evidence:[]}}]};
  }});
  expect(result.outcome.status).toBe('complete');expect(results).toHaveLength(5);
  expect(results.map(r=>r.includes('Reminder: this is the same read_transcript call'))).toEqual([false,false,true,false,false]);
  expect(db.events().filter((e:any)=>e.type==='ai.repeat_reminder')).toHaveLength(1);
 }finally{db.close();}
});
