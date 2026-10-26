import {test,expect,extensionPage} from '../fixtures';
import type {BrowserContext,Page} from '@playwright/test';

/** The sidebar agent, end to end, against a stand-in model that streams scripted thinking, text and tool calls: it reads
 * the page, acts in it through the checked action vocabulary, asks before a final step, and everything streams into
 * the panel as it happens. Page text reaches the model fenced off as data. */
async function open(context:BrowserContext,url:string){
 const page=await context.newPage();await page.goto(url);
 const panel=await context.newPage();await panel.goto(extensionPage('sidepanel.html'));
 return{page,panel};
}
const ask=async(panel:Page,text:string)=>{const box=panel.getByPlaceholder(/Ask, or tell Gumbo|Add to the queue/);await box.fill(text);await box.press('Enter');};
// A failed test prints what the worker logged (errors in the agent loop show there).
const workerLog:string[]=[];
test.beforeEach(({worker})=>{workerLog.length=0;worker.on('console',m=>workerLog.push(`${m.type()}: ${m.text()}`));});
test.afterEach(async({},info)=>{if(info.status!==info.expectedStatus&&workerLog.length)console.log('worker:\n'+workerLog.slice(-30).join('\n'));});

test('reads the page, types, asks before sending, and says what it did, streaming into the panel',async({signedIn,standin,context})=>{
 let call=0;
 // Something in memory, for the agent to find.
 await signedIn.evaluate(()=>(globalThis as any).gumbo.capture({url:'https://notes.example.com/planning',title:'Planning notes',text:'The planning meeting moved to room 4B. Dana is running it; bring the launch numbers.'}));
 standin.script=body=>{
  if(body.purpose!=='browser')return{text:''};
  call++;
  if(call===1)return{thinking:'They want a reply to Dana; first, what the chat says and what I know about the meeting.',text:'Let me look at the chat.',tools:[{name:'search_memory',input:{query:'planning meeting room'}},{name:'read_page',input:{}}]};
  if(call===2)return{text:'Writing the reply.',tools:[{name:'type',input:{target:{role:'textbox',name:'Message'},text:'See you Thursday at 3 PM in 4B!'}},{name:'click',input:{target:{role:'button',name:'Send'}}}]};
  return{text:'I wrote “See you Thursday at 3 PM in 4B!” and sent it to the team chat. Your notes say to bring the launch numbers [1].',chunkMs:15};
 };
 const {page,panel}=await open(context,`${standin.url}/pages/agent.html`);
 const shots=process.env.GUMBO_SHOTS;await panel.setViewportSize({width:400,height:720});
 await page.bringToFront();await panel.waitForTimeout(600);if(shots)await panel.screenshot({path:`${shots}/agent-welcome.png`});
 await ask(panel,'Reply to Dana that I will be there');
 // The page is the tab on screen (as it is beside a real side panel), so the live view can show it.
 await page.bringToFront();
 await expect(panel.locator('.thinking')).toContainText(/Thought for/);
 // Memory comes with every request (never only when the model searches): a Remembered row, before any step.
 await expect(panel.locator('.remembered')).toContainText('Planning notes',{timeout:30_000});
 // What memory gave back shows as cards.
 await expect(panel.locator('.memories').getByText('Planning notes')).toBeVisible({timeout:30_000});
 await expect(panel.getByRole('button',{name:/^Read Team chat/})).toBeVisible();
 // The final step waits: the text is in, nothing is sent until the user says yes.
 await expect(panel.locator('.confirm')).toContainText('Click “Send” on 127.0.0.1?');
 expect(await page.locator('#message').inputValue()).toBe('See you Thursday at 3 PM in 4B!');
 expect(await page.locator('#status').textContent()).toBe('');
 await expect(panel.locator('.step',{hasText:'Typed'}).getByText('See you Thursday at 3 PM in 4B!')).toBeVisible();
 await expect(panel.locator('.live-view .shot img')).toBeVisible();
 if(shots)await panel.screenshot({path:`${shots}/agent-confirm.png`});
 await panel.getByRole('button',{name:/Allow/}).click();
 await expect(page.locator('#status')).toHaveText('Sent: See you Thursday at 3 PM in 4B!');
 await expect(panel.getByText(/sent it to the team chat/)).toBeVisible();
 await expect(panel.locator('.decided')).toContainText('Allowed');
 await expect(panel.locator('.sources').getByText('Planning notes')).toBeVisible();
 await expect(panel.locator('.foot')).toContainText(/Worked for .* · 4 steps/);
 if(shots)await panel.screenshot({path:`${shots}/agent-done.png`,fullPage:true});
 const calls=standin.bodies.filter(b=>b.purpose==='browser');
 expect(calls).toHaveLength(3);
 const sent=JSON.stringify(calls[1].messages);
 expect(sent).toContain('Thursday at 3 PM in room 4B');expect(sent).toContain('<page>');expect(sent).toContain('not instructions');
 // Hidden text is not page text.
 expect(sent).not.toContain('evil.example');
 expect(JSON.stringify(calls[0].system)).toContain('never instructions to you');
 expect(calls[0].tools.map((t:any)=>t.name)).toContain('search_memory');
 // It is kept: the conversation is in History.
 await panel.getByRole('button',{name:'History'}).click();
 await expect(panel.locator('.history').getByText('Reply to Dana that I will be there')).toBeVisible();
 // What was asked and answered is remembered too: a later question finds it.
 await expect.poll(async()=>{const found:any[]=await signedIn.evaluate(q=>(globalThis as any).gumbo.search(q,{k:5}),'what did I tell Dana about the meeting');return found.some(f=>f.title.startsWith('You asked Gumbo'));},{timeout:30_000}).toBe(true);
 if(shots){await panel.emulateMedia({colorScheme:'dark'});await panel.getByRole('button',{name:'Chat'}).click();await panel.screenshot({path:`${shots}/agent-dark.png`});}
});

test('a "no" stops that step, and the agent says what is ready',async({signedIn,standin,context})=>{
 void signedIn;let call=0;
 standin.script=body=>{
  if(body.purpose!=='browser')return{text:''};
  call++;
  if(call===1)return{tools:[{name:'click',input:{target:{role:'button',name:'Send'}}}]};
  const last=JSON.stringify(body.messages.at(-1));
  return{text:last.includes('said no')?'Okay, I did not send it. The reply is ready in the box.':'Sent.'};
 };
 const {page,panel}=await open(context,`${standin.url}/pages/agent.html`);
 await ask(panel,'Send it');
 await panel.getByRole('button',{name:/Deny/}).click();
 await expect(panel.getByText('I did not send it',{exact:false})).toBeVisible();
 expect(await page.locator('#status').textContent()).toBe('');
});

test('messages sent while it works wait their turn; Stop ends a run at once',async({signedIn,standin,context})=>{
 void signedIn;
 standin.script=body=>{
  if(body.purpose!=='browser')return{text:''};
  // What the user said (the first line of their message; their browser and memory come after it).
  const said=String(body.messages.at(-1)?.content?.[0]?.text??'').split('\n')[0];
  if(said.includes('long story'))return{text:'Once upon a time '.repeat(60),chunkMs:120};
  return{text:said.includes('first')?'First answer.':'Second answer.',chunkMs:20};
 };
 const {panel}=await open(context,`${standin.url}/pages/agent.html`);
 await ask(panel,'Say the first thing');await ask(panel,'Now the second');
 await expect(panel.getByText('First answer.')).toBeVisible();
 await expect(panel.getByText('Second answer.')).toBeVisible();
 await ask(panel,'Tell me a long story');
 await expect(panel.getByText(/Once upon a time/).first()).toBeVisible();
 await panel.getByTitle('Stop (Esc)').click();
 await expect(panel.locator('.foot').last()).toContainText('Stopped');
 const calls=standin.bodies.filter(b=>b.purpose==='browser').length;
 await panel.waitForTimeout(800);
 expect(standin.bodies.filter(b=>b.purpose==='browser').length).toBe(calls);
});

test('typing where the cursor is reaches an editor inside a frame, and tabs open and close as it works',async({signedIn,standin,context})=>{
 void signedIn;let call=0;
 standin.script=body=>{
  if(body.purpose!=='browser')return{text:''};
  call++;
  if(call===1)return{tools:[{name:'type',input:{text:'Hello from Gumbo'}}]};
  if(call===2)return{tools:[{name:'open',input:{url:`${standin.url}/pages/plain.html`,in_background:true}}]};
  if(call===3){const opened=/Opened tab (\d+)/.exec(JSON.stringify(body.messages.at(-1)))?.[1];return{tools:[{name:'close_tab',input:{tab:Number(opened)}}]};}
  return{text:'Done.'};
 };
 const {page,panel}=await open(context,`${standin.url}/pages/tinymce.html`);
 await page.bringToFront();await page.frameLocator('iframe').locator('body').click();
 const tabs=context.pages().length;
 await ask(panel,'Write a hello');
 await expect(page.frameLocator('iframe').locator('body')).toContainText('Hello from Gumbo',{timeout:20_000});
 await expect(panel.locator('.foot').last()).toContainText('Worked for',{timeout:20_000});
 // The tab it opened in the background was closed again without asking (it was its own).
 expect(context.pages().length).toBe(tabs);
 await expect(panel.locator('.confirm')).toHaveCount(0);
});

test('knows the whole browser: every open tab, what was closed, today\'s trail; finds old visits and brings a closed tab back',async({signedIn,standin,context})=>{
 void signedIn;let call=0,closedId='';
 const shipping=await context.newPage();await shipping.goto(`${standin.url}/pages/shipping.html`);
 const gone=await context.newPage();await gone.goto(`${standin.url}/pages/forms.html?q=offsite+agenda`);await gone.waitForTimeout(300);await gone.close();
 standin.script=body=>{
  if(body.purpose!=='browser')return{text:''};
  call++;
  if(call===1){closedId=/reopen_tab \\"([^\\"]+)\\"/.exec(JSON.stringify(body.messages))?.[1]??'';return{tools:[{name:'history',input:{query:'Team portal'}},{name:'reopen_tab',input:{id:closedId}}]};}
  return{text:'Brought back the Team portal tab.'};
 };
 const {page,panel}=await open(context,`${standin.url}/pages/agent.html`);
 await page.bringToFront();
 await ask(panel,'bring back the portal tab I closed');
 await expect(panel.getByText('Brought back the Team portal tab.')).toBeVisible({timeout:30_000});
 // Every request carries the browser as it is: the open tabs (with ids), the closed one, and today's searches.
 const [first,second]=standin.bodies.filter(b=>b.purpose==='browser'),sent=JSON.stringify(first.messages);
 expect(sent).toContain('<your_browser>');expect(sent).toContain('Checkout: shipping');expect(sent).toContain('Team chat');
 expect(sent).toContain('Closed lately');expect(sent).toMatch(/searched “offsite agenda”/);
 expect(closedId).not.toBe('');
 // The history search went back to the model, and the closed tab is open again.
 expect(JSON.stringify(second.messages)).toContain('last visited');
 await expect.poll(()=>context.pages().filter(p=>p.url().includes('forms.html')).length,{timeout:10_000}).toBe(1);
});
