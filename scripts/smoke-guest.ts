import { _electron as electron } from '@playwright/test';
import {mkdtempSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
const profile=mkdtempSync(join(tmpdir(),'dream-live-guest-'));
const app=await electron.launch({executablePath:resolve('apps/desktop/out/Dream-win32-x64/Dream.exe'),args:[`--user-data-dir=${profile}`],env:{...process.env,DREAM_HEADLESS:'1',DREAM_DOCUMENTS_DIRECTORY:profile}});
try{
 const page=await app.firstWindow();await page.waitForSelector('.home-screen');
 await page.getByLabel('Ask Dream to edit').fill('Create a one-second square title card saying Dream. Use the built-in title_card only, with a dark navy background and white text. No music, no generated scenes, no review needed.');await page.getByRole('button',{name:'Send prompt'}).click();
 const deadline=Date.now()+180000;let state:any;
 do{await new Promise(r=>setTimeout(r,1000));state=await page.evaluate(()=>window.dream.command({type:'state'}));if(['interrupted','awaiting_approval','awaiting_file_permission'].includes(state.aiStatus))throw new Error(state.messages.at(-1)?.text??state.aiStatus);}while(state.aiStatus!=='complete'&&Date.now()<deadline);
 if(state.aiStatus!=='complete'||!state.experience?.firstDraftVersionId||state.timeline.settings.width!==state.timeline.settings.height||!state.timeline.attached.length)throw new Error('Guest request did not produce the requested saved square title.');
 const account:any=await page.evaluate(()=>window.dream.command({type:'account',action:'get'}));
 const output=resolve('artifacts/guest-title.mp4');await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});},output);await page.evaluate(()=>window.dream.exportVideo());
 writeFileSync(resolve('artifacts/guest-live.png'),Buffer.from(await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG().toString('base64')),'base64'));
 const report={guest:account.guest===true,completed:true,projectId:state.meta.id,versionId:state.versionId,width:state.timeline.settings.width,height:state.timeline.settings.height,items:state.timeline.attached.length,output,checkedAt:new Date().toISOString()};writeFileSync(resolve('artifacts/guest-live.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
}finally{await app.close();}
