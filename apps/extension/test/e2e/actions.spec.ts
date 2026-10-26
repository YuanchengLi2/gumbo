import {test,expect,tell} from '../fixtures';

/** The action vocabulary in a page: every action is checked, final ones wait for Enter, and targets are found by name,
 * role and the text around them. */
test('runs and checks every action, and holds final ones for Enter',async({page,worker,standin})=>{
 await page.goto(`${standin.url}/pages/actions.html`);
 const act=(action:unknown,extra:Record<string,unknown>={})=>tell(worker,page,{type:'act',action,...extra});

 const shown=await act({do:'click',target:{name:'Show details'}});
 expect(shown).toMatchObject({ok:true,changed:true});await expect(page.locator('#details')).toBeVisible();
 const dead=await act({do:'click',target:{name:'Does nothing'}});
 expect(dead.ok).toBe(false);expect(dead.detail).toContain('nothing changed');

 expect(await act({do:'select',target:{name:'Size'},option:'Large'})).toMatchObject({ok:true});
 await expect(page.locator('#size')).toHaveValue('l');
 expect((await act({do:'select',target:{name:'Choose a color',role:'combobox'},option:'Green'})).ok).toBe(true);
 await expect(page.locator('#combo')).toHaveText('Green');

 // Two buttons named Remove: the words around one pick it.
 expect(await act({do:'click',target:{name:'Remove',nearby:'Invoice 13'}})).toMatchObject({ok:false,irreversible:true});
 const removed=await act({do:'click',target:{name:'Remove',nearby:'Invoice 13'}},{confirmed:true});expect(removed.ok,JSON.stringify(removed)).toBe(true);
 await expect(page.getByText('Invoice 13')).toHaveCount(0);await expect(page.getByText('Invoice 12')).toHaveCount(1);

 expect((await act({do:'type',target:{name:'Name'},text:'Dana Park'})).ok).toBe(true);
 await expect(page.locator('#name')).toHaveValue('Dana Park');
 // Sending is final: it is held until confirmed.
 const held=await act({do:'click',target:{name:'Send'}});expect(held).toMatchObject({ok:false,irreversible:true});
 await expect(page.locator('#sent')).toBeHidden();
 expect((await act({do:'click',target:{name:'Send'}},{confirmed:true})).ok).toBe(true);
 await expect(page.locator('#sent')).toBeVisible();

 expect(await act({do:'click',target:{name:'Go to section 2'}})).toMatchObject({ok:true});expect(page.url()).toContain('#section2');
 await act({do:'click',target:{name:'Load more'}});
 expect(await act({do:'wait',for:{selector:'#late'}})).toMatchObject({ok:true});
 const read=await act({do:'read',target:{name:'Section 2',role:'heading'}});expect(read.value).toBe('Section 2');
 const model=await tell(worker,page,{type:'page.model'});
 expect(model.items.some((i:any)=>i.role==='combobox'&&i.name==='Green')).toBe(true);
});
