import {test,expect,tell} from '../fixtures';
import type {Page,Frame,Worker} from '@playwright/test';

/** Tab and Ctrl+K predict what the user will do, not only what they will type: Ctrl+K opens with the likely things to do
 * (from the selection at once, then the model's), and can carry out something in the page step by step; Tab offers the
 * next action when writing is done ("Send", "Search") and fills a whole form from what Gumbo knows, with undo. */
async function card(page:Page):Promise<Frame>{
 await expect.poll(()=>page.frames().some(f=>f.url().includes('card.html')),{timeout:5000}).toBe(true);
 const frame=page.frames().find(f=>f.url().includes('card.html'))!;await frame.locator('#instruction').waitFor();return frame;
}
const tab=(worker:Worker,page:Page)=>tell(worker,page,{type:'debug.predict'});
/** The id the page model gave an element, read from what the predictor was sent. */
const idIn=(body:any,name:string)=>new RegExp(`(e\\d+) \\w+ "${name}"`).exec(body.messages[0].content.map((c:any)=>c.text).join('\n'))?.[1];
const isPredict=(b:any)=>/autocomplete for actions/.test(JSON.stringify(b.system));
const setFacts=(worker:Worker,facts:Record<string,string>)=>worker.evaluate(f=>chrome.storage.local.get('settings').then(({settings})=>chrome.storage.local.set({settings:{...(settings as object),facts:f}})),facts);

test('Ctrl+K opens with what the user most likely wants: the selection\'s own ideas at once, the model\'s a moment later',async({page,signedIn,standin})=>{
 void signedIn;
 standin.script=b=>/predict what a person wants/.test(JSON.stringify(b.system))?{text:'[{"text":"RSVP yes to the offsite","kind":"page"},{"text":"Add this to my calendar","kind":"act"}]'}:{text:''};
 await page.goto(`${standin.url}/pages/forms.html`);
 await page.locator('#meeting').selectText();await page.keyboard.press('Control+k');
 const frame=await card(page);
 // A date and an address in the selection: the calendar and the map are offered before anything is typed.
 await expect(frame.locator('.idea').first()).toBeVisible();
 await expect(frame.locator('.ideas')).toContainText('Add this to my calendar');
 await expect(frame.locator('.ideas')).toContainText('RSVP yes to the offsite');
 await expect(frame.locator('.ideas')).toContainText('Show this on a map');
 // Arrows choose, Tab puts the idea in the box to change it.
 await page.keyboard.press('ArrowDown');await page.keyboard.press('Tab');
 expect(await frame.locator('#instruction').inputValue()).not.toBe('');
});

test('Ctrl+K does something in the page, its steps in the card, a final step waiting for Enter',async({page,signedIn,standin})=>{
 void signedIn;let call=0;
 standin.script=b=>{
  if(/predict what a person wants/.test(JSON.stringify(b.system)))return{text:'[{"text":"Reply that I will be there","kind":"page"}]'};
  if(b.purpose!=='browser')return{text:''};
  call++;
  if(call===1)return{tools:[{name:'type',input:{target:{role:'textbox',name:'Message'},text:'Yes, I will be there!'}},{name:'click',input:{target:{role:'button',name:'Send'}}}]};
  return{text:'Replied that you will be there.'};
 };
 await page.goto(`${standin.url}/pages/forms.html`);
 await page.locator('#meeting').selectText();await page.keyboard.press('Control+k');
 const frame=await card(page);
 await expect(frame.locator('.ideas')).toContainText('Reply that I will be there');
 await frame.locator('.idea',{hasText:'Reply that I will be there'}).click();
 await expect(frame.locator('.step',{hasText:'Typed'})).toBeVisible();
 await expect(frame.locator('.confirm')).toContainText('Click “Send”');
 expect(await page.locator('#status').textContent()).toBe('');
 await page.keyboard.press('Enter');
 await expect(page.locator('#status')).toHaveText('Sent: Yes, I will be there!');
 await expect(frame.locator('.said')).toContainText('Replied that you will be there.');
});

test('Tab does what would help next, text and clicks together: the reply is written and sent, the send waiting for Enter',async({page,signedIn,standin})=>{
 void signedIn;
 standin.script=b=>isPredict(b)&&JSON.stringify(b.messages).includes('typed: Message')?{text:JSON.stringify({label:'Send the reply',confidence:0.9,steps:[{do:'click',id:idIn(b,'Send')}]})}:{text:''};
 await page.goto(`${standin.url}/pages/forms.html`);await page.locator('#msg').click();
 await page.keyboard.type('Yes, see you there.',{delay:10});
 await expect.poll(async()=>(await tab(signedIn,page))?.label,{timeout:8000}).toBe('Send the reply');
 await page.keyboard.press('Tab');
 await expect.poll(async()=>(await tab(signedIn,page))?.waiting).toBe(true);
 expect(await page.locator('#status').textContent()).toBe('');
 await page.keyboard.press('Enter');
 await expect(page.locator('#status')).toHaveText('Sent: Yes, see you there.');
});

test('Tab types and acts in one go: a search is filled in and run',async({page,signedIn,standin})=>{
 void signedIn;
 standin.script=b=>isPredict(b)?{text:JSON.stringify({label:'Search for the offsite',confidence:0.85,steps:[{do:'type',id:idIn(b,'Search the portal'),text:'offsite'},{do:'key',id:idIn(b,'Search the portal'),combo:'Enter'}]})}:{text:''};
 await page.goto(`${standin.url}/pages/forms.html`);
 await expect.poll(async()=>(await tab(signedIn,page))?.label,{timeout:8000}).toBe('Search for the offsite');
 expect((await tab(signedIn,page)).steps).toBe(2);
 await page.keyboard.press('Tab');
 await expect(page.locator('#status')).toHaveText('Searched: offsite');
});

test('Tab fills a form with the user’s own details at once, before any model answers',async({page,signedIn,standin})=>{
 await setFacts(signedIn,{name:'Dana Lee',email:'dana@example.com'});
 standin.script=()=>({text:'',firstMs:3000});
 await page.goto(`${standin.url}/pages/forms.html`);await page.locator('#first').click();
 await expect.poll(async()=>(await tab(signedIn,page))?.label,{timeout:2500}).toBe('Fill in your details');
 await page.keyboard.press('Tab');
 await expect(page.locator('#first')).toHaveValue('Dana');await expect(page.locator('#last')).toHaveValue('Lee');
 await expect(page.locator('#email')).toHaveValue('dana@example.com');
});

test('a step that would type something nobody said is never offered',async({page,signedIn,standin})=>{
 void signedIn;
 standin.script=b=>isPredict(b)?{text:JSON.stringify({label:'Sign up',confidence:0.95,steps:[{do:'type',id:idIn(b,'Email'),text:'someone@invented.example'}]})}:{text:''};
 await page.goto(`${standin.url}/pages/forms.html`);
 await expect.poll(()=>standin.bodies.filter(isPredict).length,{timeout:8000}).toBeGreaterThan(0);
 await page.waitForTimeout(800);
 expect((await tab(signedIn,page))?.showing).toBeFalsy();
});

test('when what Tab is doing needs more than is on the page, the agent carries on: a menu opens, then its item is chosen',async({page,signedIn,standin})=>{
 void signedIn;let agent=0;
 standin.script=b=>{
  if(isPredict(b))return{text:JSON.stringify({label:'Switch the font to Roboto',confidence:0.9,steps:[{do:'click',id:idIn(b,'Font: Arial')}],more:true})};
  if(b.purpose!=='browser')return{text:''};
  agent++;
  if(agent===1)return{tools:[{name:'click',input:{target:{role:'menuitem',name:'Roboto'}}}]};
  return{text:'The font is Roboto now.'};
 };
 await page.goto(`${standin.url}/pages/toolbar.html`);
 await expect.poll(async()=>(await tab(signedIn,page))?.label,{timeout:8000}).toBe('Switch the font to Roboto');
 await page.keyboard.press('Tab');
 await expect(page.locator('#font')).toHaveText('Font: Roboto',{timeout:15000});
 // The agent was told what Tab had done and what it was finishing.
 const sent=JSON.stringify(standin.bodies.find(b=>b.purpose==='browser').messages);
 expect(sent).toContain('Switch the font to Roboto');expect(sent).toContain('Already done here');
});

test('a guess shows as soon as its first step has arrived, and grows as the rest is written',async({page,signedIn,standin})=>{
 void signedIn;
 standin.script=b=>{
  if(!isPredict(b))return{text:''};
  const json=JSON.stringify({confidence:0.9,label:'Search for the offsite',steps:[{do:'type',id:idIn(b,'Search the portal'),text:'offsite'},{do:'key',id:idIn(b,'Search the portal'),combo:'Enter'}]});
  const cut=json.indexOf('{"do":"key"')+5;
  return{chunks:[json.slice(0,cut),json.slice(cut)],chunkMs:2500};
 };
 await page.goto(`${standin.url}/pages/forms.html`);
 // The first step is on screen while the model is still writing the second.
 await expect.poll(async()=>(await tab(signedIn,page))?.label,{timeout:2400}).toBe('Search for the offsite');
 const early=await tab(signedIn,page);expect(early.final).toBe(false);expect(early.steps).toBe(1);
 await expect.poll(async()=>(await tab(signedIn,page))?.final,{timeout:6000}).toBe(true);
 expect((await tab(signedIn,page)).steps).toBe(2);
 await page.keyboard.press('Tab');
 await expect(page.locator('#status')).toHaveText('Searched: offsite');
});

test('what the user turned down is not offered again on that page, and the model is told',async({page,signedIn,standin})=>{
 void signedIn;
 standin.script=b=>isPredict(b)?{text:JSON.stringify({confidence:0.9,label:'Search for the offsite',steps:[{do:'type',id:idIn(b,'Search the portal'),text:'offsite'}]})}:{text:''};
 await page.goto(`${standin.url}/pages/forms.html`);
 await expect.poll(async()=>(await tab(signedIn,page))?.label,{timeout:8000}).toBe('Search for the offsite');
 await page.keyboard.press('Escape');
 expect((await tab(signedIn,page))?.showing).toBeFalsy();
 const asked=standin.bodies.filter(isPredict).length;
 await page.locator('h1').click();
 await expect.poll(()=>standin.bodies.filter(isPredict).length,{timeout:8000}).toBeGreaterThan(asked);
 await page.waitForTimeout(700);
 expect((await tab(signedIn,page))?.showing).toBeFalsy();
 expect(JSON.stringify(standin.bodies.filter(isPredict).at(-1).messages)).toContain('they_turned_down_here');
});

test('what was copied a moment ago in another tab is what Tab fills in',async({page,context,signedIn,standin})=>{
 void signedIn;
 standin.script=b=>{
  if(!isPredict(b))return{text:''};
  if(!JSON.stringify(b.messages).includes('just_copied'))return{text:'{"confidence":0,"steps":[]}'};
  return{text:JSON.stringify({confidence:0.9,label:'Use the address you copied',steps:[{do:'type',id:idIn(b,'Street address'),text:'410 Lakeview Drive'}]})};
 };
 await page.goto(`${standin.url}/pages/forms.html`);
 // Selected and copied as a person does it (Ctrl+C).
 await page.evaluate(()=>{const t=document.getElementById('meeting')!.firstChild!,s=t.textContent!,r=document.createRange();r.setStart(t,s.indexOf('410'));r.setEnd(t,s.indexOf('Drive')+5);getSelection()!.removeAllRanges();getSelection()!.addRange(r);});
 await page.keyboard.press('Control+c');
 await expect.poll(()=>signedIn.evaluate(()=>chrome.storage.session.get('lately').then(r=>JSON.stringify(r))),{timeout:5000}).toContain('410 Lakeview Drive');
 const second=await context.newPage();
 await second.goto(`${standin.url}/pages/shipping.html`);await second.bringToFront();await second.locator('#street').click();
 await expect.poll(async()=>(await tab(signedIn,second))?.label,{timeout:8000}).toBe('Use the address you copied');
 // What it would type shows faintly in the field the cursor is in, where it would land.
 expect((await tab(signedIn,second)).preview).toBe('410 Lakeview Drive');
 await second.keyboard.press('Tab');
 await expect(second.locator('#street')).toHaveValue('410 Lakeview Drive');
});
