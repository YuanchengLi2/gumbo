import {test,expect,tell} from '../fixtures';
import type {Page,Worker} from '@playwright/test';
/** Tab for text that feels instant: longer suggestions in one run, alternatives to switch to, the next part asked ahead
 * so taking one shows the next at once, never a request per keystroke, and Alt+Q through Chrome's command. */
const tabState=(worker:Worker,page:Page)=>tell(worker,page,{type:'debug.tab'});
const asked=(standin:any)=>standin.bodies.filter((b:any)=>b.purpose==='tab');
const textOf=(b:any)=>/<text>\\n([\s\S]*?)⟨cursor⟩/.exec(JSON.stringify(b.messages))?.[1]??'';

test('a longer suggestion, in one run, and the typing switches to an alternative',async({page,signedIn,standin})=>{
 void signedIn;
 standin.script=b=>b.purpose==='tab'?{text:' the notes from our call. I will read them carefully. Talk soon!\n⟂\n the slides you sent.'}:{text:''};
 await page.goto(`${standin.url}/pages/plain.html`);await page.locator('#ta').click();
 await page.keyboard.type('Thanks for',{delay:20});
 await expect.poll(async()=>(await tabState(signedIn,page))?.rest,{timeout:5000}).toBe(' the notes from our call. I will read them carefully. Talk soon!');
 expect((await tabState(signedIn,page)).alternatives).toEqual([' the slides you sent.']);
 const before=asked(standin).length;
 await page.keyboard.type(' the s',{delay:30});
 expect((await tabState(signedIn,page)).rest).toBe('lides you sent.');
 await page.waitForTimeout(350);expect(asked(standin).length).toBe(before);
});

test('Alt and + (and Alt and −) go through the other ways to go on, and Alt+Q takes the one shown',async({page,signedIn,standin})=>{
 void signedIn;
 standin.script=b=>b.purpose==='tab'?{text:' the notes from our call.\n⟂\n the slides you sent.\n⟂\n your help today.'}:{text:''};
 await page.goto(`${standin.url}/pages/plain.html`);await page.locator('#ta').click();
 await page.keyboard.type('Thanks for',{delay:20});
 await expect.poll(async()=>(await tabState(signedIn,page))?.rest,{timeout:5000}).toBe(' the notes from our call.');
 // The alternatives come with the whole answer.
 await expect.poll(async()=>(await tabState(signedIn,page))?.final,{timeout:5000}).toBe(true);
 await page.keyboard.press('Alt+Equal');expect((await tabState(signedIn,page)).rest).toBe(' the slides you sent.');
 await page.keyboard.press('Alt+Equal');expect((await tabState(signedIn,page)).rest).toBe(' your help today.');
 await page.keyboard.press('Alt+Minus');expect((await tabState(signedIn,page)).rest).toBe(' the slides you sent.');
 // The keys went to Tab, not the page.
 await expect(page.locator('#ta')).toHaveValue('Thanks for');
 await page.keyboard.press('Alt+q');await expect(page.locator('#ta')).toHaveValue('Thanks for the slides you sent.');
});

test('typing mid-word never sends a request per keystroke',async({page,signedIn,standin})=>{
 void signedIn;standin.script=()=>({text:'',firstMs:200});
 await page.goto(`${standin.url}/pages/plain.html`);await page.locator('#ta').click();
 const words='Could you please forward the quarterly numbers';
 await page.keyboard.type(words,{delay:25});await page.waitForTimeout(400);
 const n=asked(standin).length,count=words.split(' ').length;
 console.log(`${n} requests for ${words.length} keystrokes (${count} words)`);
 expect(n).toBeLessThanOrEqual(count+2);
});

test('the part after a suggestion is asked ahead: taking it shows the next part at once, typing elsewhere drops it',async({page,signedIn,standin})=>{
 void signedIn;
 standin.script=b=>{if(b.purpose!=='tab')return{text:''};const t=textOf(b);return{text:/for$/.test(t)?' the notes from our call.':/call\.$/.test(t)?' Talk soon!':''};};
 await page.goto(`${standin.url}/pages/plain.html`);await page.locator('#ta').click();
 await page.keyboard.type('Thanks for',{delay:20});
 await expect.poll(async()=>(await tabState(signedIn,page))?.rest,{timeout:5000}).toBe(' the notes from our call.');
 // The continuation was asked before anything was taken.
 await expect.poll(()=>asked(standin).some((b:any)=>/call\.$/.test(textOf(b))),{timeout:5000}).toBe(true);
 const before=asked(standin).length;
 await page.keyboard.press('Alt+q');
 await expect(page.locator('#ta')).toHaveValue('Thanks for the notes from our call.');
 // Shown the moment the part asked ahead is in (at once, when it came before the press), with no new request.
 await expect.poll(async()=>(await tabState(signedIn,page))?.rest,{timeout:2000}).toBe(' Talk soon!');
 expect((await tabState(signedIn,page)).from).toBe('cache');
 expect(asked(standin).filter((b:any)=>/call\.$/.test(textOf(b))).length).toBe(1);
 expect(asked(standin).length-before).toBeLessThanOrEqual(1);
 // Typing something else: the kept continuation is not shown.
 await page.keyboard.type(' Cheers',{delay:20});
 expect((await tabState(signedIn,page)).rest??'').not.toContain('Talk soon');
});

test('Alt+Q as Chrome\'s command takes the suggestion in the frame with the focus, and the hop is timed',async({page,signedIn,standin})=>{
 standin.script=b=>b.purpose==='tab'?{text:' the notes from our call.'}:{text:''};
 await page.goto(`${standin.url}/pages/plain.html`);await page.locator('#ta').click();
 await page.keyboard.type('Thanks for',{delay:20});
 await expect.poll(async()=>(await tabState(signedIn,page))?.showing,{timeout:5000}).toBe(true);
 const ms:number=await signedIn.evaluate(async()=>{const [tab]=await chrome.tabs.query({url:'*://*/pages/plain.html'});const at=performance.now();await chrome.tabs.sendMessage(tab.id!,{type:'take'});return performance.now()-at;});
 // The hop is measured on every Alt+Q (the debug page's "take"); in a loaded headless run it varies widely, so here it
 // is reported, and only a hop that would be felt fails.
 console.log(`Alt+Q command hop: ${ms.toFixed(1)} ms from the worker to the page taking it`);
 await expect(page.locator('#ta')).toHaveValue('Thanks for the notes from our call.');
 expect(ms).toBeLessThan(2000);
});
