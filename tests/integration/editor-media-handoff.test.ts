import {it,expect,vi} from 'vitest';
import {mkdtempSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ProjectDB} from '@dream/project-db';
import {AssetSchema} from '@dream/footage';
import {Workspace} from '../../apps/project-service/src/workspace';
import {call,textOf} from '../fixtures/agent-project';
import {prepareProjectPackages} from '../../apps/project-service/src/project-packages';
import {editingActivity,editingChanges} from '../../apps/desktop/src/renderer/editing-language';

it('starts fresh projects without installing starter packages',async()=>{
 const run=vi.fn();for(let n=0;n<2;n++){const db=new ProjectDB(mkdtempSync(join(tmpdir(),'dream-no-download-')));try{const ws=new Workspace(db,{run,ffmpeg:'',ffprobe:''},()=>{});await ws.initialize();await prepareProjectPackages(db,run,()=>{},new AbortController().signal);expect(JSON.parse(readFileSync(join(ws.root,'package.json'),'utf8')).dependencies).toBeUndefined();expect(existsSync(join(ws.root,'node_modules'))).toBe(false);}finally{db.close();}}expect(run).not.toHaveBeenCalled();
});
it('uses the imported copy and retrieves newly completed speech from the current database',async()=>{
 const db=new ProjectDB(mkdtempSync(join(tmpdir(),'dream-audio-handoff-'))),path=join(db.folder,'Media/Originals/voice.mp3');writeFileSync(path,'fixture');const run=vi.fn();
 try{db.saveAsset(AssetSchema.parse({id:'voice',filename:'voice.mp3',kind:'audio',hasAudio:true,durationSec:2,originalPath:path,fingerprint:'voice',status:'ready'}));db.job('voice','transcription','running');
 const ws=new Workspace(db,{run,ffmpeg:'',ffprobe:''},()=>{});await ws.initialize();
 expect(JSON.parse(readFileSync(join(ws.root,'footage/assets.json'),'utf8'))[0].path).toBe('../Media/Originals/voice.mp3');
 expect(textOf(await call(ws,'read',{path:'footage/voice-voice/transcript.txt'}))).toContain('Still being transcribed');
 // Speech completed since: the file has it when it is next read.
 db.saveRecords('words',[{id:'word',assetId:'voice',text:'Hello',start:0,end:1,confidence:1,speaker:'unknown',pauseBefore:0}]);db.job('voice','transcription','complete',100);
 expect(textOf(await call(ws,'read',{path:'footage/voice-voice/transcript.txt'}))).toMatch(/\[0\.0-1\.0\] Hello/);expect(run).not.toHaveBeenCalled();ws.close();
 }finally{db.close();}
});
it('shows editing progress for stored developer activity and omits source filenames',()=>{
 expect(editingActivity({id:'run',sequence:0,kind:'action',status:'complete',tool:'run_command',text:'Running project code',output:'npm install three'})).toBe('Preparing the edit');expect(editingChanges(['Created src/scene.html','Set the frame rate to 24 fps'])).toEqual(['Set the frame rate to 24 fps']);
});
