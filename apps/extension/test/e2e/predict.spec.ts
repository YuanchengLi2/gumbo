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
// A failed test prints what the page and the worker logged.
const logs:string[]=[];
test.beforeEach(({worker,page})=>{logs.length=0;worker.on('console',m=>logs.push(`worker ${m.type()}: ${m.text()}`));page.on('console',m=>logs.push(`page ${m.type()}: ${m.text()}`));page.on('pageerror',e=>logs.push(`page error: ${e.message}`));});
test.afterEach(async({standin},info)=>{if(info.status!==info.expectedStatus)console.log(`asked: ${standin.bodies.map((b:any)=>b.purpose).join(', ')}\n${logs.slice(-30).join('\n')}`);});
/** The id the page model gave an element, read from what the predictor was sent. */
const idIn=(body:any,name:string)=>new RegExp(`(e\\d+) \\w+ "${name}"`).exec(body.messages[0].content.map((c:any)=>c.text).join('\n'))?.[1];
const isPredict=(b:any)=>/You are Gumbo's Tab/.test(JSON.stringify(b.system));
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

test('Tab, Tab: the search is typed, and the next move (running it) is there the moment it is',async({page,signedIn,standin})=>{
 void signedIn;
 // The model would rather not be asked again: after the first move, nothing new comes for a while.
 let asked=0;
 standin.script=b=>{if(!isPredict(b))return{text:''};asked++;return asked<=3?{text:JSON.stringify({confidence:0.85,label:'Search for the offsite',steps:[{do:'type',id:idIn(b,'Search the portal'),text:'offsite'},{do:'key',id:idIn(b,'Search the portal'),combo:'Enter'}],then:{do:'key',id:idIn(b,'Search the portal'),combo:'Enter'}})}:{text:'{"confidence":0,"steps":[]}',firstMs:4000};};
 await page.goto(`${standin.url}/pages/forms.html`);
 await expect.poll(async()=>(await tab(signedIn,page))?.label,{timeout:8000}).toBe('Search for the offsite');
 // One move: the typing (the Enter after it is the next move).
 expect((await tab(signedIn,page)).steps).toBe(1);
 await page.keyboard.press('Tab');
 await expect(page.locator('#q')).toHaveValue('offsite');
 await expect.poll(async()=>(await tab(signedIn,page))?.label,{timeout:1000}).toBe('Press Enter');
 expect((await tab(signedIn,page)).source).toBe('then');
 await page.keyboard.press('Tab');
 await expect(page.locator('#status')).toHaveText('Searched: offsite');
});

test('Tab fills a form with the user’s own details at once, before any model answers',async({page,signedIn,standin})=>{
 await setFacts(signedIn,{name:'Dana Lee',email:'dana@example.com'});
 standin.script=()=>({text:'',firstMs:3000});
 await page.goto(`${standin.url}/pages/forms.html`);await page.locator('#first').click();
 await expect.poll(async()=>(await tab(signedIn,page))?.label,{timeout:2500}).toBe('Fill in your details');
 // Every field it fills is outlined, and what goes in each shows faintly in it.
 const shown=await tab(signedIn,page);expect(shown.outlined).toBe(3);expect(shown.previews).toEqual(['Dana','Lee','dana@example.com']);
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

test('Tab, Tab: a menu opens, and its item, not on the page until then, is the next move; the agent is never asked',async({page,signedIn,standin})=>{
 void signedIn;let asked=0;
 standin.script=b=>{
  if(!isPredict(b))return{text:''};asked++;
  return asked<=2?{text:JSON.stringify({confidence:0.9,label:'Open the font menu',steps:[{do:'click',id:idIn(b,'Font: Arial')}],then:{do:'click',role:'menuitem',name:'Roboto'}})}:{text:'{"confidence":0,"steps":[]}',firstMs:4000};
 };
 await page.goto(`${standin.url}/pages/toolbar.html`);
 await expect.poll(async()=>(await tab(signedIn,page))?.label,{timeout:8000}).toBe('Open the font menu');
 await page.keyboard.press('Tab');
 await expect.poll(async()=>(await tab(signedIn,page))?.label,{timeout:1500}).toBe('Click “Roboto”');
 await page.keyboard.press('Tab');
 await expect(page.locator('#font')).toHaveText('Font: Roboto');
 expect(standin.bodies.some(b=>b.purpose==='browser')).toBe(false);
});

test('Tab makes every move a hand makes: drags a card onto a column, sorts a row by mouse, sets a slider, opens a menu by pointing, renames by double-click, right-clicks a row',async({page,signedIn,standin})=>{
 void signedIn;let move:((b:any)=>unknown)|undefined;
 standin.script=b=>isPredict(b)&&move?{text:JSON.stringify(move(b))}:{text:'{"confidence":0,"steps":[]}'};
 await page.goto(`${standin.url}/pages/board.html`);
 const offer=async(label:string,next:(b:any)=>unknown)=>{
  move=b=>({confidence:0.9,label,steps:[next(b)]});
  await page.locator('h1').click();
  await expect.poll(async()=>(await tab(signedIn,page))?.label,{timeout:8000}).toBe(label);
  move=undefined;await page.keyboard.press('Tab');
 };
 const id=(b:any,name:string)=>new RegExp(`(e\\d+) \\w+ "${name}"`).exec(b.messages[0].content.map((c:any)=>c.text).join('\n'))?.[1];
 // Native drag and drop: the drop is outlined too.
 await offer('Move “Write tests” to Done',b=>({do:'drag',id:id(b,'Write tests'),to:id(b,'Done')}));
 await expect(page.locator('#status')).toHaveText('Moved Write tests to Done');
 await expect(page.locator('#done')).toContainText('Write tests');
 // A list sorted with the mouse (press, move, release).
 await offer('Put Gamma first',b=>({do:'drag',id:id(b,'Gamma'),to:id(b,'Alpha')}));
 await expect(page.locator('#status')).toHaveText('Order: Gamma, Alpha, Beta');
 // A slider dragged to where it should be.
 await offer('Turn the volume up',b=>({do:'drag',id:id(b,'Volume'),by:[60,0]}));
 await expect(page.locator('#status')).toHaveText(/Volume \d+/);expect(Number(await page.locator('#volume').inputValue())).toBeGreaterThan(20);
 // A menu that opens when pointed at.
 await offer('Open More',b=>({do:'hover',id:id(b,'More')}));
 await expect(page.locator('#menu')).toHaveClass(/open/);
 await offer('Rename the sprint',b=>({do:'double_click',id:id(b,'Sprint 12')}));
 await expect(page.locator('#status')).toHaveText('Renaming');
 await offer('Open the row menu',b=>({do:'right_click',id:id(b,'Release notes')}));
 await expect(page.locator('#status')).toHaveText('Row menu');
});

test('Tab works inside a frame from another site, and knows what the tab the user just left said',async({page,context,signedIn,standin})=>{
 void signedIn;
 standin.script=b=>{
  if(!isPredict(b))return{text:''};
  const sent=b.messages[0].content.map((c:any)=>c.text).join('\n');
  // Only a guess made inside the activity's frame, with the chat's answer in hand, offers the answer.
  if(!/embedded frame/.test(sent)||!/Cenamos a las ocho/.test(sent))return{text:'{"confidence":0,"steps":[]}'};
  return{text:JSON.stringify({confidence:0.9,label:'Answer from your chat',steps:[{do:'type',id:idIn(b,'Your answer'),text:'Cenamos a las ocho.'}],then:{do:'click',id:idIn(b,'Check answer')}})};
 };
 await page.goto(`${standin.url}/pages/chat.html`);await page.bringToFront();await page.waitForTimeout(600);
 const lesson=await context.newPage();await lesson.goto(`${standin.url}/pages/lesson.html`);await lesson.bringToFront();
 const activity=lesson.frameLocator('#activity');
 await activity.locator('#answer').click();
 await expect.poll(async()=>(await tab(signedIn,lesson))?.label,{timeout:10_000}).toBe('Answer from your chat');
 // The frame was asked about by itself, with the page around it named, and the chat it came from in hand.
 const asked=JSON.stringify(standin.bodies.filter(isPredict).at(-1).messages);
 expect(asked).toContain('Lesson 4B practice');expect(asked).toContain('the_tab_they_just_left');
 await lesson.keyboard.press('Tab');
 await expect(activity.locator('#answer')).toHaveValue('Cenamos a las ocho.');
 // And the next move, inside the frame too.
 await expect.poll(async()=>(await tab(signedIn,lesson))?.label,{timeout:1500}).toBe('Click “Check answer”');
 await lesson.keyboard.press('Tab');
 await expect(activity.locator('#result')).toHaveText('Checked: Cenamos a las ocho.');
});

test('a page drawn as pixels: Tab sees a picture of it, and its moves point at spots: select, drag to Done, type in a drawn box',async({page,signedIn,standin})=>{
 void signedIn;let move:((b:any)=>unknown)|undefined;
 standin.script=b=>isPredict(b)&&move?{text:JSON.stringify(move(b))}:{text:'{"confidence":0,"steps":[]}'};
 await page.goto(`${standin.url}/pages/sketch.html`);await page.waitForTimeout(1200);
 // The guess carries a picture of the view, and says how to point at what is in it.
 const pictured=()=>standin.bodies.filter(isPredict).some(b=>b.messages[0].content.some((c:any)=>c.type==='image')&&/drawn as pixels/.test(JSON.stringify(b.messages)));
 await expect.poll(pictured,{timeout:8000}).toBe(true);
 // The view is 1200 wide, so the picture's pixels are the page's.
 const offer=async(label:string,step:unknown)=>{
  move=()=>({confidence:0.9,label,steps:[step]});
  await page.mouse.click(1000,600);
  await expect.poll(async()=>(await tab(signedIn,page))?.label,{timeout:8000}).toBe(label);
  expect((await tab(signedIn,page)).outlined).toBeGreaterThan(0);
  move=undefined;await page.keyboard.press('Tab');
 };
 await offer('Select Write tests',{do:'click',at:[160,130]});
 await expect(page.locator('#status')).toHaveText('Selected: Write tests');
 await offer('Move Write tests to Done',{do:'drag',at:[160,130],to_at:[760,260]});
 await expect(page.locator('#status')).toHaveText('Moved Write tests to Done');
 await offer('Rename Fix login bug',{do:'double_click',at:[160,260]});
 await expect(page.locator('#status')).toHaveText('Editing Fix login bug');
 await offer('Search for login',{do:'type',at:[440,26],text:'login'});
 await expect(page.locator('#find')).toHaveValue('login');
});

test('Ctrl+K on a page drawn as pixels sends a picture of it',async({page,signedIn,standin})=>{
 void signedIn;
 standin.script=b=>b.purpose==='inline'?{text:'ANSWER\nTwo notes, and a Done area.'}:{text:''};
 await page.goto(`${standin.url}/pages/sketch.html`);await page.waitForTimeout(800);
 await page.mouse.click(1000,600);await page.keyboard.press('Control+k');
 const frame=await card(page);await page.keyboard.type('what is on this board?');await page.keyboard.press('Enter');
 await expect(frame.locator('.body')).toContainText('Two notes');
 expect(standin.bodies.filter(b=>b.purpose==='inline').at(-1).messages[0].content.some((c:any)=>c.type==='image')).toBe(true);
});

test('Ctrl+K in a drawn document that types through a hidden frame (as Google Docs does): the card opens by the selection, sees it in the picture, and the edit goes in through the frame',async({page,signedIn,standin})=>{
 void signedIn;
 standin.script=b=>b.purpose==='inline'?{text:'EDIT\nsoon'}:{text:''};
 await page.goto(`${standin.url}/pages/drawn-doc.html`);await page.waitForTimeout(800);
 // Double-click "will" (drawn at about x 230 to 262, on the line at y 200).
 await page.mouse.dblclick(245,195);await page.waitForTimeout(300);
 await page.keyboard.press('Control+k');
 const frame=await card(page);
 // The card is in the page itself (not in the one-pixel frame), just below the selected line.
 expect(frame.parentFrame()).toBe(page.mainFrame());
 const box=(await (await frame.frameElement()).boundingBox())!;
 expect(box.y).toBeGreaterThan(190);expect(box.y).toBeLessThan(260);
 await page.keyboard.type('a shorter word');await page.keyboard.press('Enter');
 await expect(frame.locator('.body')).toContainText('soon');
 const asked=standin.bodies.filter(b=>b.purpose==='inline').at(-1);
 expect(asked.messages[0].content.some((c:any)=>c.type==='image')).toBe(true);
 expect(JSON.stringify(asked.messages[0].content)).toContain('highlighted');
 // Kept: typed into the frame, which still holds the selection.
 await page.keyboard.press('Enter');
 await expect(page.locator('#status')).toContainText('pasted: Launch plan Our launch soon happen');
 // Tab for text never asks about the hidden frame (it holds none of their words).
 expect(standin.bodies.some(b=>b.purpose==='tab')).toBe(false);
});

test('Tab for text in a drawn document: the words come from a picture with the cursor marked, show by the cursor, and Tab types them through the hidden box',async({page,signedIn,standin,worker})=>{
 void signedIn;
 // What they typed goes with the picture (the words meet it exactly); once the summer is there, the next words differ.
 standin.script=b=>b.purpose!=='tab'||!/drawn as pixels/.test(JSON.stringify(b.system))?{text:''}:/just typed “[^”]*summer/.test(JSON.stringify(b.messages))?{text:' with ten teams'}:{text:' before the summer'};
 await page.goto(`${standin.url}/pages/drawn-doc.html`);await page.waitForTimeout(800);
 await page.mouse.dblclick(245,195);await page.waitForTimeout(300);
 await page.keyboard.type('soon');
 await expect.poll(()=>tell(worker,page,{type:'debug.drawn'}).then((s:any)=>s?.shown),{timeout:8000}).toBe(' before the summer');
 const asked=standin.bodies.filter(b=>b.purpose==='tab').at(-1);
 expect(asked.messages[0].content[0].type).toBe('image');
 await page.keyboard.press('Tab');
 await expect(page.locator('#status')).toContainText('pasted: Launch plan Our launch soon before the summer happen');
 expect(await tell(worker,page,{type:'debug.drawn'}).then((s:any)=>s?.shown)).toBeUndefined();
 // Another key instead of Tab puts the words away.
 await page.keyboard.type(',');
 await expect.poll(()=>tell(worker,page,{type:'debug.drawn'}).then((s:any)=>s?.shown),{timeout:8000}).toBe(' with ten teams');
 await page.keyboard.press('a');
 await expect.poll(()=>tell(worker,page,{type:'debug.drawn'}).then((s:any)=>s?.shown),{timeout:2000}).toBeUndefined();
});

test('a frame the user has not worked in never asks',async({page,signedIn,standin})=>{
 void signedIn;
 await page.goto(`${standin.url}/pages/lesson.html`);await page.waitForTimeout(2500);
 // The page itself asks once as it loads; the activity's frame, untouched, does not.
 expect(standin.bodies.filter(isPredict).filter(b=>/embedded frame/.test(JSON.stringify(b.messages))).length).toBe(0);
});

test('what the user drags by hand is what the next guess knows',async({page,signedIn,standin})=>{
 void signedIn;
 await page.goto(`${standin.url}/pages/board.html`);
 await page.locator('#c2').dragTo(page.locator('#done'));
 await expect(page.locator('#status')).toHaveText('Moved Fix login bug to Done');
 await expect.poll(()=>JSON.stringify(standin.bodies.filter(isPredict).at(-1)?.messages??''),{timeout:8000}).toContain('dragged');
});

test('a move shows as soon as its first field has arrived, and grows as the rest is written',async({page,signedIn,standin})=>{
 void signedIn;
 standin.script=b=>{
  if(!isPredict(b))return{text:''};
  const json=JSON.stringify({confidence:0.9,label:'Fill in the sign-up',steps:[{do:'type',id:idIn(b,'First name'),text:'Dana'},{do:'type',id:idIn(b,'Company'),text:'Team portal'}]});
  const cut=json.indexOf('{"do":"type","id":"',json.indexOf('Dana'))+5;
  return{chunks:[json.slice(0,cut),json.slice(cut)],chunkMs:2500};
 };
 await page.goto(`${standin.url}/pages/forms.html`);
 // The first field is on screen while the model is still writing the second.
 await expect.poll(async()=>(await tab(signedIn,page))?.label,{timeout:2400}).toBe('Fill in the sign-up');
 const early=await tab(signedIn,page);expect(early.final).toBe(false);expect(early.steps).toBe(1);
 await expect.poll(async()=>(await tab(signedIn,page))?.final,{timeout:6000}).toBe(true);
 expect((await tab(signedIn,page)).steps).toBe(2);
 await page.keyboard.press('Tab');
 await expect(page.locator('#first')).toHaveValue('Dana');await expect(page.locator('#company')).toHaveValue('Team portal');
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

test('the Free plan with credits to spare guesses ahead, as every plan does (it is how people try Gumbo)',async({page,signedIn,standin})=>{
 void signedIn;standin.billing={plan:'free',credits:{left:40,planTotal:50}};
 standin.script=b=>isPredict(b)?{text:JSON.stringify({confidence:0.9,label:'Continue to payment',steps:[{do:'click',id:idIn(b,'Continue')}]})}:{text:''};
 await page.goto(`${standin.url}/pages/shipping.html`);
 await page.locator('#city').hover();
 // The page as it opened, its first field and the field the pointer rests on: asked before any click.
 await expect.poll(()=>standin.bodies.filter(isPredict).length,{timeout:8000}).toBeGreaterThanOrEqual(2);
});

test('a menu that opens on hover by CSS alone: its hidden items are seen with their menu, marked on its trigger, and Tab opens one',async({page,signedIn,standin})=>{
 void signedIn;
 standin.script=b=>isPredict(b)&&/opened|went to/.test(JSON.stringify(b.messages))?{text:JSON.stringify({confidence:0.9,label:'Open Pricing',steps:[{do:'click',id:/(e\d+) link "Pricing" \[in the “Products” menu, shown on hover\]/.exec(b.messages[0].content.map((c:any)=>c.text).join('\n'))?.[1]}]})}:{text:''};
 await page.goto(`${standin.url}/pages/hover-menu.html`);
 await page.mouse.click(600,400);
 await expect.poll(async()=>(await tab(signedIn,page))?.label,{timeout:8000}).toBe('Open Pricing');
 // A ring shows, on what opens the menu (the item itself is hidden, and would have none).
 expect((await tab(signedIn,page)).outlined).toBe(1);
 await page.keyboard.press('Tab');
 await expect(page.locator('#status')).toHaveText('Opened Pricing');
});

test('saving the last credits (a sixth left): nothing is guessed ahead of the user, and the move comes once they act',async({page,signedIn,standin})=>{
 void signedIn;standin.billing={plan:'free',credits:{left:6,planTotal:50}};
 standin.script=b=>isPredict(b)?{text:JSON.stringify({confidence:0.9,label:'Continue to payment',steps:[{do:'click',id:idIn(b,'Continue')}]})}:{text:''};
 await page.goto(`${standin.url}/pages/shipping.html`);
 // The page opening (its first field asked ahead) and the pointer resting on a field: no model is asked for either.
 await page.locator('#city').hover();await page.waitForTimeout(1200);
 // At most the page as it opened was asked about (with credits to spare, the first field and the hover are too).
 const before=standin.bodies.filter(isPredict).length;expect(before).toBeLessThanOrEqual(1);
 await page.locator('#city').click();
 await expect.poll(()=>standin.bodies.filter(isPredict).length,{timeout:8000}).toBeGreaterThan(before);
 await expect.poll(async()=>(await tab(signedIn,page))?.label,{timeout:8000}).toBe('Continue to payment');
});

test('what was copied a moment ago in another tab is what Tab fills in',async({page,context,signedIn,standin})=>{
 void signedIn;
 standin.script=b=>{
  if(!isPredict(b))return{text:''};
  // Only once what was copied is in the question (with the rest of their browser).
  if(!/They copied:[\s\S]*410 Lakeview Drive/.test(b.messages[0].content.map((c:any)=>c.text).join('\n')))return{text:'{"confidence":0,"steps":[]}'};
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
