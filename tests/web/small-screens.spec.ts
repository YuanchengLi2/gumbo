import {test,expect,type Page} from '@playwright/test';
import {resolve} from 'node:path';

/** The editing screen on small screens and a clicked clip, as found on October 24: on a phone the project name ran under
 * the Gumbo/Editor switch and the Editor layout was squeezed into the top of the screen with half of it empty; scrolled
 * sideways, the ruler slid over the track labels; and in Gumbo's layout a clicked clip the playhead was not on never
 * showed in the preview. SHOTS_DIR, when set, keeps a screenshot of each. */
const fixture=resolve('artifacts/fixtures/source.mp4'),shots=process.env.SHOTS_DIR;
const state=(page:Page)=>page.evaluate(()=>(window as any).dream.command({type:'state'}));
const shot=async(page:Page,name:string)=>{if(shots)await page.screenshot({path:`${shots}/${name}.png`});};
const box=async(page:Page,selector:string)=>(await page.locator(selector).first().boundingBox())!;
const apart=(a:{x:number;width:number},b:{x:number;width:number})=>a.x+a.width<=b.x+1||b.x+b.width<=a.x+1;

test('the editing screen works on a phone, scrolled, and shows a clicked clip',async({page})=>{
 test.setTimeout(180_000);
 await page.setViewportSize({width:1280,height:720});
 await page.goto('/app/');await expect(page.getByText('What are we cooking today?')).toBeVisible({timeout:90_000});
 await page.evaluate(()=>(window as any).dream.createProject({requestId:'small-screens',text:'',paths:[]}));
 await page.reload();await page.getByRole('button',{name:'Untitled project'}).first().click();
 await expect(page.getByText('Your canvas is ready')).toBeVisible({timeout:30_000});
 await page.getByRole('button',{name:'Media'}).first().click();
 await page.evaluate(async url=>{const file=new File([await (await fetch(url)).blob()],'source.mp4',{type:'video/mp4'}),data=new DataTransfer();data.items.add(file);
  const panel=document.querySelector<HTMLElement>('.project-media')!;for(const type of ['dragover','drop'])panel.dispatchEvent(new DragEvent(type,{bubbles:true,cancelable:true,dataTransfer:data}));},'/app/@fs/'+fixture.replace(/\\/g,'/'));
 await expect.poll(async()=>(await state(page)).footage.assets[0]?.status,{timeout:90_000}).toBe('ready');
 const asset=(await state(page)).footage.assets[0];
 for(let i=0;i<3;i++){
  await page.evaluate(id=>{const lane=document.querySelector<HTMLElement>('.manual-track-lane[data-track="video"]')!,box=lane.getBoundingClientRect(),data=new DataTransfer();data.setData('application/x-dream-asset',id);
   const at={bubbles:true,cancelable:true,dataTransfer:data,clientX:box.right-4,clientY:box.top+box.height/2};for(const type of ['dragenter','dragover','drop'])lane.dispatchEvent(new DragEvent(type,at));},asset.id);
  await expect.poll(async()=>(await state(page)).timeline.spine.length,{timeout:15_000}).toBe(i+1);
 }

 // Gumbo's layout: a clicked clip the playhead is not on comes into the preview (the second clip starts at 0:06).
 const time=page.getByText(/^\d+:\d\d \/ 0:18$/).first();await expect(time).toHaveText('0:00 / 0:18');
 const second=(await state(page)).timeline.spine[1].id;
 await page.evaluate(id=>document.querySelector<HTMLElement>(`[data-item-id="${id}"]`)?.scrollIntoView({inline:'nearest'}),second);
 await page.locator(`[data-item-id="${second}"]`).dispatchEvent('pointerdown',{button:0,bubbles:true});
 await page.locator(`[data-item-id="${second}"]`).dispatchEvent('pointerup',{button:0,bubbles:true});
 await expect(time).toHaveText('0:06 / 0:18',{timeout:5000});

 // Scrolled sideways, the ruler goes under the labels' corner as the clips go under the labels.
 await page.locator('.manual-timeline-scroll').first().evaluate(el=>{el.scrollLeft=120;});await page.waitForTimeout(300);
 const corner=await box(page,'.manual-ruler-corner'),label=await box(page,'.manual-track-label');
 expect(Math.abs(corner.x-label.x)).toBeLessThan(2);expect(Math.abs(corner.width-label.width)).toBeLessThan(2);
 expect(await page.evaluate(()=>{const c=document.querySelector('.manual-ruler-corner')!.getBoundingClientRect();return document.elementFromPoint(c.x+c.width/2,c.y+c.height/2)?.className;})).toBe('manual-ruler-corner');
 await shot(page,'scrolled-1280');

 // A phone, Gumbo's layout: the name and the switch side by side.
 await page.setViewportSize({width:390,height:844});await page.waitForTimeout(800);
 expect(apart(await box(page,'.project-title'),await box(page,'.layout-switch'))).toBe(true);
 await shot(page,'phone-gumbo');

 // A phone, the editor: the picture on top, the tools and settings, and the timeline, all on screen.
 await page.getByRole('radio',{name:'Editor'}).click();await page.waitForTimeout(1200);
 const view=page.viewportSize()!,preview=await box(page,'.editor-preview'),assets=await box(page,'.editor-assets'),props=await box(page,'.editor-properties'),timeline=await box(page,'.editor-layout .manual-timeline');
 expect(preview.height).toBeGreaterThan(150);expect(preview.width).toBeGreaterThan(360);
 expect(assets.y).toBeGreaterThanOrEqual(preview.y+preview.height-1);expect(assets.width).toBeGreaterThan(360);expect(assets.height).toBeGreaterThan(80);
 expect(props.height).toBeGreaterThan(60);
 expect(timeline.y+timeline.height).toBeLessThanOrEqual(view.height+1);expect(timeline.height).toBeGreaterThan(100);
 expect(apart(await box(page,'.project-title'),await box(page,'.layout-switch'))).toBe(true);
 await shot(page,'phone-editor');
});
