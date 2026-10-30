import {test,expect,tell} from '../fixtures';
import type {Page,Worker} from '@playwright/test';

/** Tab for actions, from habits: something the user does nearly every time after the same step is offered at once (no
 * model needed), Tab runs it (and checks it), a final step waits for Enter, the action meter scores the learner on the
 * user's own steps, and history comes in. */
const chip=(worker:Worker,page:Page)=>tell(worker,page,{type:'debug.predict'});
async function habit(page:Page,url:string,first:string,second:string,times:number){
 for(let i=0;i<times;i++){await page.goto(url);await page.getByRole('button',{name:first}).click();await page.waitForTimeout(150);await page.getByRole('button',{name:second}).click();await page.waitForTimeout(150);}
}

test('offers the usual next step, and Tab takes it',async({page,signedIn,standin})=>{
 const url=`${standin.url}/pages/flow.html`;
 await habit(page,url,'Edge Functions','Logs',6);
 await page.goto(url);await page.getByRole('button',{name:'Edge Functions'}).click();
 await expect.poll(async()=>(await chip(signedIn,page))?.label,{timeout:6000}).toContain('Logs');
 await page.keyboard.press('Alt+q');
 await expect(page.locator('#view')).toHaveAttribute('data-view','logs');
 const meter=await signedIn.evaluate(()=>(globalThis as any).gumbo.measureActions());
 expect(meter.shown).toBeGreaterThan(3);expect(meter.precision).toBeGreaterThan(0.8);
});

test('a final step waits for Enter',async({page,signedIn,standin})=>{
 const url=`${standin.url}/pages/flow.html`;
 await habit(page,url,'Settings','Delete project',6);
 await page.goto(url);await page.getByRole('button',{name:'Settings'}).click();
 await expect.poll(async()=>(await chip(signedIn,page))?.label,{timeout:6000}).toContain('Delete project');
 await page.keyboard.press('Alt+q');
 await expect.poll(async()=>(await chip(signedIn,page))?.waiting).toBe(true);
 await expect(page.locator('#view')).not.toHaveAttribute('data-view','deleted');
 await page.keyboard.press('Enter');
 await expect(page.locator('#view')).toHaveAttribute('data-view','deleted');
});

test('no chip while typing in a field; Esc dismisses one',async({page,signedIn,standin})=>{
 const url=`${standin.url}/pages/flow.html`;
 await habit(page,url,'Edge Functions','Logs',6);
 await page.goto(url);await page.getByRole('button',{name:'Edge Functions'}).click();
 await expect.poll(async()=>(await chip(signedIn,page))?.showing,{timeout:6000}).toBe(true);
 await page.keyboard.press('Escape');expect((await chip(signedIn,page)).showing).toBe(false);
 await page.goto(`${standin.url}/pages/plain.html`);await page.locator('#ta').click();await page.waitForTimeout(3000);
 expect((await chip(signedIn,page))?.showing).toBeFalsy();
});

// Since Oct 29 history teaches habits and becomes visits, never searchable pages (memory is what the user saw), and
// bookmarks are not brought in.
test('brings in history as visits for habits, not as pages',async({page,signedIn,standin})=>{
 for(const p of ['flow.html','plain.html','actions.html'])await page.goto(`${standin.url}/pages/${p}`);
 const state=await signedIn.evaluate(()=>(globalThis as any).gumbo.importHistory());
 expect(state.state).toBe('done');expect(state.visits).toBeGreaterThan(0);expect(state.pages).toBe(0);
});
