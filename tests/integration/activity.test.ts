import {it,expect} from 'vitest';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ProjectDB} from '@dream/project-db';
import {emptyTimeline,ClipSchema} from '@dream/timeline';
import {timelineChanges} from '../../packages/project-db/src/activity';

it('keeps each request’s execution steps and completed file changes after another request and reopen',()=>{const folder=mkdtempSync(join(tmpdir(),'dream-activity-'));let db=new ProjectDB(folder,'Activity');try{
 db.setMeta('pending_request',JSON.stringify({turnId:'first',text:'Edit notes'}));db.userMessage('Edit notes','first');db.setMeta('ai_status','running');db.activityStep({id:'read',label:'Reading notes.txt',status:'complete'});db.activityStep({id:'write',label:'Updating notes.txt',status:'waiting'});db.activityStep({id:'write',label:'Updating notes.txt',status:'complete'});db.recordFileChanges('first','receipt',['Updated notes.txt']);db.recordFileChanges('first','receipt',['Updated notes.txt']);db.message('assistant','Your notes are updated.','first');db.setMeta('ai_status','complete');
 db.setMeta('pending_request',JSON.stringify({turnId:'second',text:'Next edit'}));db.userMessage('Next edit','second');db.setMeta('ai_status','running');db.close();db=new ProjectDB(folder);
 const first=db.state().messages.find(m=>m.turnId==='first')!;expect(first.activity?.steps).toHaveLength(2);expect(first.activity?.steps[1].status).toBe('complete');expect(first.activity?.changes).toEqual(['Updated notes.txt']);expect(first.activity?.status).toBe('complete');expect(db.experience().steps).toEqual([]);
}finally{db.close();}});

it('summarizes the saved result and describes actual canvas and title changes',()=>{const before=emptyTimeline('edit'),after=structuredClone(before);after.settings.width=1080;after.settings.height=1920;after.attached.push({id:'title',type:'overlay',component:'lower_third',start:{kind:'project',at:'start',offsetSec:0},durationSec:2,layer:0,params:{text:'Our story'},reason:'Title'});expect(timelineChanges(before,after,()=>'' )).toEqual(['Changed the video format to 9:16','Added text “Our story”']);
 const intermediate=structuredClone(before);intermediate.spine.push(ClipSchema.parse({id:'clip',assetId:'source',srcIn:0,srcOut:2,reason:'Temporary edit'}));const restored=structuredClone(before);expect(timelineChanges(before,restored,()=> 'source.mp4')).toEqual([]);
});
