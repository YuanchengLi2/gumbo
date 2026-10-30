import {test,expect,tell} from '../fixtures';

/** A busy app, as complex apps are: thousands of elements before its controls in the page's code, rows that are plain
 * boxes the app makes clickable in script, icon buttons with no words, and a page that changes all the time by itself (a
 * clock, a presence dot, a counter, a live region). Tab must see all of it, and know whether a step did anything. */
test('sees every control of a busy app, and names what has no words',async({page,worker,standin})=>{
 await page.goto(`${standin.url}/pages/busy.html`);
 const model=await tell(worker,page,{type:'page.model'});
 const named=(name:string)=>model.items.find((i:any)=>i.name===name);
 // After five thousand elements of history in the page's code.
 expect(named('Does nothing'),JSON.stringify(model.items.map((i:any)=>i.name))).toBeTruthy();
 expect(named('Save draft')).toBeTruthy();
 // Icon buttons, by their icon's name, their tooltip, or their icon set's class.
 expect(named('trash')?.role).toBe('button');
 expect(named('Archive')?.role).toBe('button');
 expect(named('star')?.role).toBe('button');
 // Rows that are plain boxes, clickable only in script: each is one button (not each of its words).
 const rows=model.items.filter((i:any)=>/Quarterly report|Offsite dates/.test(i.name));
 expect(rows.map((r:any)=>r.role)).toEqual(['button','button']);
 expect(model.items.some((i:any)=>i.name==='Priya')).toBe(false);
});

test('a step counts as done only when it did what it does, however busy the page',async({page,worker,standin})=>{
 await page.goto(`${standin.url}/pages/busy.html`);
 const act=(action:unknown,extra:Record<string,unknown>={})=>tell(worker,page,{type:'act',action,...extra});
 // The page ticks every 60 ms; a button that does nothing still did nothing.
 const dead=await act({do:'click',target:{name:'Does nothing'}});
 expect(dead.ok,JSON.stringify(dead)).toBe(false);expect(dead.detail).toContain('nothing changed');
 // A toggle is pressed once: no second try undoes it.
 expect((await act({do:'click',target:{name:'star'}})).ok).toBe(true);
 await expect(page.locator('#star')).toHaveAttribute('aria-pressed','true');
 // The page saying so somewhere else (a status at the bottom, a word or two).
 expect((await act({do:'click',target:{name:'Save draft'}})).ok).toBe(true);
 await expect(page.locator('#saved')).toHaveText('Draft saved');
 expect((await act({do:'click',target:{name:'trash'}})).ok).toBe(true);
 await expect(page.locator('#saved')).toHaveText('Moved to trash');
 // A menu opening (archiving is final: it waits for Enter).
 expect((await act({do:'click',target:{name:'Archive'}},{confirmed:true})).ok).toBe(true);
 await expect(page.locator('#menu')).toBeVisible();
 // A row the app makes clickable, found again by its words after the app drew the list anew.
 await page.evaluate(()=>(window as any).drawRows());
 const opened=await act({do:'click',target:{name:'Quarterly report'}});
 expect(opened.ok,JSON.stringify(opened)).toBe(true);
 await expect(page.locator('#reader')).toContainText('numbers are up twelve percent');
});
