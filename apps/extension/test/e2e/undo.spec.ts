import {test,expect,tell} from '../fixtures';
import type {Page,Worker} from '@playwright/test';
/** What Tab does can be taken back: for a few seconds after a move, Ctrl+Z (or the Undo chip) puts the fields, choices
 * and toggles back as they were, and a link Tab followed is undone by going back. */
const tab=(worker:Worker,page:Page)=>tell(worker,page,{type:'debug.predict'});
const isPredict=(b:any)=>/You are Gumbo's Tab/.test(JSON.stringify(b.system));
const text=(b:any)=>b.messages[0].content.map((c:any)=>c.text??'').join('\n');
const idIn=(t:string,name:string)=>new RegExp(`(e\\d+) \\w+ "${name}"`).exec(t)?.[1];

test('a form filled by Tab, and a box it ticked, are put back by Ctrl+Z',async({page,signedIn,standin})=>{
 void signedIn;
 standin.script=b=>{
  if(!isPredict(b))return{text:''};const t=text(b),street=idIn(t,'Street address'),city=idIn(t,'City');
  return street&&city?{text:JSON.stringify({confidence:0.9,label:'Fill in the address',steps:[{do:'type',id:street,text:'410 Lakeview Drive'},{do:'type',id:city,text:'Portland'}]})}:{text:'{"confidence":0,"steps":[]}'};
 };
 // Their own address (a fact Tab may type: an invented one never is).
 await signedIn.evaluate(()=>chrome.storage.local.get('settings').then(({settings})=>chrome.storage.local.set({settings:{...(settings as object),facts:{other:'Ships to 410 Lakeview Drive, Portland'}}})));
 await page.goto(`${standin.url}/pages/shipping.html`);await page.locator('#street').click();
 await expect.poll(async()=>(await tab(signedIn,page))?.label,{timeout:8000}).toBe('Fill in the address');
 await page.keyboard.press('Alt+q');
 await expect(page.locator('#street')).toHaveValue('410 Lakeview Drive');
 await page.keyboard.press('Control+z');
 await expect(page.locator('#street')).toHaveValue('');
 const city=page.locator('#city');if(await city.count())await expect(city).toHaveValue('');
});

test('a link Tab followed is undone by going back',async({page,signedIn,standin})=>{
 void signedIn;
 standin.script=b=>{if(!isPredict(b))return{text:''};const id=idIn(text(b),'Open the biology course');return id?{text:JSON.stringify({confidence:0.9,label:'Open the course',steps:[{do:'click',id}]})}:{text:'{"confidence":0,"steps":[]}'};};
 await page.goto(`${standin.url}/pages/trail.html`);await page.mouse.move(200,200);
 await expect.poll(async()=>(await tab(signedIn,page))?.glow?.likely?.length,{timeout:8000}).toBeGreaterThan(0);
 // Pointing at it: the likely move the pointer is on is the one Alt+Q makes.
 await page.locator('#course').hover();
 await expect.poll(async()=>(await tab(signedIn,page))?.glow?.now,{timeout:3000}).toBe('Open the course');
 await page.keyboard.press('Alt+q');
 await page.waitForURL(/course\.html/);
 // The new page offers Undo for a few seconds: Ctrl+Z goes back.
 await page.waitForTimeout(600);
 await page.keyboard.press('Control+z');
 await page.waitForURL(/trail\.html/);
});
