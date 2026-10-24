import {test,expect,devices,type Page} from '@playwright/test';
import {resolve} from 'node:path';

/** Gumbo on a phone, as Android Chrome has it: no file or folder picker API. Footage comes in through the plain file
 * input, the project stacks (picture on top, panels below, nothing wider than the screen), it plays, and the export
 * downloads. */
const {defaultBrowserType:_,...pixel}=devices['Pixel 7'];
test.use(pixel);
const state=(page:Page)=>page.evaluate(()=>(window as any).dream.command({type:'state'}));
const overflow=(page:Page)=>page.evaluate(()=>document.documentElement.scrollWidth-innerWidth);

test('the core flow works on a phone without the picker APIs',async({page})=>{
 test.setTimeout(240_000);
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{const w=window as any;delete w.showDirectoryPicker;delete w.showOpenFilePicker;delete w.showSaveFilePicker;});
 await page.goto('/app/');await expect(page.getByText('What are we cooking today?')).toBeVisible({timeout:60_000});
 // The home's top bar reaches the account and a new video.
 await expect(page.locator('.home-side')).toBeVisible();expect(await overflow(page)).toBe(0);

 await page.evaluate(()=>(window as any).dream.createProject({requestId:'web-phone',text:'',paths:[]}));
 await page.reload();await page.getByRole('button',{name:'Untitled project'}).first().click();
 await expect(page.getByText('Your canvas is ready')).toBeVisible({timeout:30_000});
 // Stacked: the picture above the panels, each the screen's width.
 const [stage,side]=await Promise.all(['.ai-stage','.ai-workspace>.sidebar'].map(s=>page.locator(s).boundingBox()));
 expect(stage!.y).toBeLessThan(side!.y);expect(side!.width).toBeGreaterThan(300);

 await page.getByRole('button',{name:'Media'}).first().click();
 const [chooser]=await Promise.all([page.waitForEvent('filechooser'),page.getByRole('button',{name:/Import/}).first().click()]);
 await chooser.setFiles(resolve('artifacts/fixtures/source.mp4'));
 await expect.poll(async()=>(await state(page)).footage.assets[0]?.status,{timeout:90_000}).toBe('ready');
 const asset=(await state(page)).footage.assets[0];
 await page.evaluate(id=>{const lane=document.querySelector<HTMLElement>('.manual-track-lane[data-track="video"]')!,box=lane.getBoundingClientRect(),data=new DataTransfer();data.setData('application/x-dream-asset',id);
  const at={bubbles:true,cancelable:true,dataTransfer:data,clientX:box.left+4,clientY:box.top+box.height/2};for(const type of ['dragenter','dragover','drop'])lane.dispatchEvent(new DragEvent(type,at));},asset.id);
 await expect.poll(async()=>(await state(page)).timeline.spine.length,{timeout:15_000}).toBe(1);

 const time=page.getByText(/^\d+:\d\d \/ 0:06$/).first();await expect(time).toHaveText('0:00 / 0:06',{timeout:15_000});
 await page.getByRole('button',{name:'Play'}).first().click();await expect(time).not.toHaveText('0:00 / 0:06',{timeout:10_000});
 await page.getByRole('button',{name:'Pause'}).first().click();

 await page.getByRole('button',{name:'Export'}).first().click();
 const dialog=page.getByRole('dialog',{name:'Export'});await expect(dialog).toBeVisible();
 // No folder to choose on a phone: the export downloads.
 await expect(dialog.getByRole('button',{name:'Choose folder'})).toHaveCount(0);
 const [download]=await Promise.all([page.waitForEvent('download',{timeout:120_000}),dialog.getByRole('button',{name:'Export',exact:true}).click()]);
 expect(download.suggestedFilename()).toBe('Untitled project.mp4');
 expect(await overflow(page)).toBe(0);expect(errors).toEqual([]);
});
