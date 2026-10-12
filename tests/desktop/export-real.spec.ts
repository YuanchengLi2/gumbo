import {test,expect,_electron as electron} from '@playwright/test';
import {mkdtempSync,mkdirSync,readdirSync,statSync,existsSync} from 'node:fs';import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';

/** Exports a real project in the packaged app and reports the time and the peak space its work files took.
 * DREAM_EXPORT_PROJECT=<project folder> [DREAM_EXPORT_OUT=<folder>] npx playwright test tests/desktop/export-real.spec.ts */
test('exports a real project, reporting time and peak work space',async()=>{
 const folder=process.env.DREAM_EXPORT_PROJECT;test.skip(!folder,'Set DREAM_EXPORT_PROJECT to a project folder.');test.setTimeout(3_600_000);
 const out=resolve(process.env.DREAM_EXPORT_OUT??mkdtempSync(join(tmpdir(),'dream-export-out-')));mkdirSync(out,{recursive:true});const output=join(out,'export.mp4');
 const size=(path:string):number=>{try{const s=statSync(path);return s.isDirectory()?readdirSync(path).reduce((n,f)=>n+size(join(path,f)),0):s.size;}catch{return 0;}};
 const app=await electron.launch({executablePath:resolve(process.env.DREAM_PACKAGE_EXECUTABLE??'apps/desktop/out/Dream-win32-x64/Dream.exe'),args:['--user-data-dir='+mkdtempSync(join(tmpdir(),'dream-export-profile-'))],env:{...process.env,DREAM_HEADLESS:'1'}});
 try{
  const page=await app.firstWindow();
  await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},resolve(folder!));
  await page.evaluate(()=>window.dream.pickProject(true));await page.evaluate(async folder=>{await window.dream.command({type:'open',folder});},resolve(folder!));
  await app.evaluate(({dialog},output)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:output});},output);
  // Everything the export writes lives beside the output, so the folder's size over time is its footprint.
  let peak=0;const started=Date.now(),timer=setInterval(()=>{peak=Math.max(peak,size(out));},2000);
  let result:any;try{result=await page.evaluate(async()=>window.dream.exportVideo('video'));}finally{clearInterval(timer);}
  const seconds=Math.round((Date.now()-started)/1000);
  console.log(`exported in ${seconds}s; peak work space ${(peak/1e9).toFixed(2)} GB; output ${(size(output)/1e6).toFixed(0)} MB`);
  expect(result?.path).toBe(output);expect(existsSync(output)).toBe(true);
  expect(readdirSync(out).filter(f=>f!=='export.mp4')).toEqual([]);
 }finally{await app.close();}
});
