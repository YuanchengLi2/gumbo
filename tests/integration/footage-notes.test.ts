import {it,expect} from 'vitest';
import {mkdtempSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ProjectDB} from '@dream/project-db';
import {AssetSchema} from '@dream/footage';
import {compactConversation} from '../../packages/orchestrator/src/conversation';

/** Footage notes (conversation.ts footageNotes): what the agent saw in the sources survives a summary, so it does not look
 * at the same footage again. */
const exchanges=(from:number,to:number)=>{
 const messages:any[]=[];
 for(let n=from;n<to;n++){
  const input=n%5===4?{target:'preview',startSec:0,endSec:8}:n%5===3?{query:'red lanterns'}:{assetId:'trip',startSec:n*10,endSec:n*10+8};
  messages.push({role:'assistant',content:[{type:'text',text:n===from?'Starting.':`Look ${n-1}: lanterns and a scooter at ${(n-1)*10}s, good opener.`},{type:'tool_use',id:'look'+n,name:n%5===3?'find_shots':'view_media',input}]},
   {role:'user',content:[{type:'tool_result',tool_use_id:'look'+n,content:'Frames and words at the times asked. '+'.'.repeat(6000)}]});
 }
 return messages;
};
const digestOf=(view:any[])=>view.map(m=>{try{return JSON.parse(m.content);}catch{return undefined;}}).find(v=>v?.notice?.startsWith('Older tool exchanges were compacted.'));

it('keeps each look at a source with what the agent noted, and carries the notes into the next summary',()=>{
 const db=new ProjectDB(mkdtempSync(join(tmpdir(),'dream-footage-notes-')));
 try{
  db.saveAsset(AssetSchema.parse({id:'trip',filename:'trip.mp4',kind:'video',originalPath:'trip.mp4',durationSec:600,width:1920,height:1080,fps:30,hasAudio:true,fingerprint:'trip',status:'ready'}));
  const first=[{role:'user',content:'Make a highlight of the trip.'},...exchanges(0,20)];
  const view=compactConversation(db,'turn',first,40000,true),digest=digestOf(view);
  expect(digest.footageSeen).toContain('view_media trip.mp4 10s-18s: Look 1: lanterns and a scooter at 10s, good opener.');
  // The same search made again keeps only its newest note.
  const searches=digest.footageSeen.filter((line:string)=>line.startsWith('find_shots "red lanterns": '));
  expect(searches).toHaveLength(1);expect(Number(searches[0].match(/Look (\d+)/)[1])).toBeGreaterThan(3);
  // Looks at the edit itself go stale with the next change, so they are not kept.
  expect(digest.footageSeen.some((line:string)=>line.includes('view_media 0s-8s'))).toBe(false);
  expect(digest.notice).toContain('footageSeen is what you saw in the source footage');
  // The next summary keeps the earlier notes and adds the new ones.
  const second=compactConversation(db,'turn',[...view,...exchanges(20,40)],40000,true),later=digestOf(second);
  expect(later.footageSeen).toContain('view_media trip.mp4 10s-18s: Look 1: lanterns and a scooter at 10s, good opener.');
  expect(later.footageSeen.some((line:string)=>line.startsWith('view_media trip.mp4 210s-218s: Look 21'))).toBe(true);
  expect(later.footageSeen.length).toBeLessThanOrEqual(30);
 }finally{db.close();}
});
