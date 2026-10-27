import {test,expect,extensionPage} from '../fixtures';

test('signs in through usegumbo.app with its own PKCE session, out of the web app\'s sight',async({context,worker,page,standin})=>{
 // usegumbo.app is played by stubs: the sign-in page, and /app, which records whether its own script saw the code.
 await context.route('https://usegumbo.app/**',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><title>stub</title><script>window.sawCode=location.search.includes('code=');document.title='app '+location.search;</script>`}));
 await page.goto(extensionPage('popup.html'));
 await expect(page.getByText('Sign in with your Gumbo account to turn on')).toBeVisible();
 const signinTab=context.waitForEvent('page');await page.getByRole('button',{name:'Sign in'}).click();
 const opened=await signinTab;await opened.waitForLoadState();
 const url=new URL(opened.url());expect(url.origin+url.pathname).toBe('https://usegumbo.app/signin/');
 expect(url.searchParams.get('web')).toBe('https://usegumbo.app/app/?ext=1');expect(url.searchParams.get('challenge')).toMatch(/^[A-Za-z0-9_-]{43}$/);
 // Google (or the emailed link) returns to /app with the code; the extension takes it and shows its welcome page.
 const back=await context.newPage();await back.goto('https://usegumbo.app/app/?ext=1&code=good-code');
 await back.waitForURL(extensionPage('welcome.html?signed=1'));await expect(back.getByText('Gumbo is ready.')).toBeVisible();
 const session=await worker.evaluate(async()=>(await chrome.storage.local.get('session')).session);
 expect(session).toMatchObject({refresh_token:'fixture-refresh',user:{email:'friend@example.com'}});
 // An old emailed link opened later changes nothing; signed out, a code the extension did not ask for is refused.
 const again=await context.newPage();await again.goto('https://usegumbo.app/app/?ext=1&code=good-code');await again.waitForURL(extensionPage('welcome.html?signed=1'));
 await worker.evaluate(()=>chrome.storage.local.remove('session'));
 const stray=await context.newPage();await stray.goto('https://usegumbo.app/app/?ext=1&code=good-code');
 await stray.waitForURL(/welcome\.html\?error=/);await expect(stray.getByText('This sign-in was not started from Gumbo for Chrome')).toBeVisible();
});

test('models nobody picked follow the defaults; one the user picked stays',async({signedIn,page})=>{
 // Settings saved before October 26: Tab, next moves and notes on the defaults, Ctrl+K chosen by the user.
 await signedIn.evaluate(()=>chrome.storage.local.set({settings:{enabled:true,pausedUntil:0,siteOff:[],altK:[],models:{tab:'claude-haiku-5-5',inline:'groq-fast',action:'claude-haiku-5-5',notes:'claude-haiku-5-5',agent:'deepseek-flash'},facts:{},listen:true,listenOff:[],mic:false}}));
 await page.goto(extensionPage('popup.html'));
 const selects=page.locator('select');
 await expect(selects.nth(0)).toHaveValue('claude-haiku-5-5');
 await expect(selects.nth(1)).toHaveValue('groq-fast');
 await expect(selects.nth(3)).toHaveValue('deepseek-flash');
});

test('the popup shows the site, pause, Tab numbers, spend and memory when signed in',async({signedIn,page})=>{
 await page.goto(extensionPage('popup.html'));
 await expect(page.getByText('Tab on this computer')).toBeVisible();
 await expect(page.getByText("Today's AI: $0.04")).toBeVisible();
 await expect(page.getByText('friend@example.com')).toBeVisible();
 await page.getByRole('button',{name:'Pause for an hour'}).click();
 await expect(page.getByText(/^Paused until/)).toBeVisible();
 const settings:any=await signedIn.evaluate(async()=>(await chrome.storage.local.get('settings')).settings);expect(settings.pausedUntil).toBeGreaterThan(Date.now());
 await page.getByRole('button',{name:'Resume'}).click();
 await page.locator('select').first().selectOption('claude-sonnet-5-5');
 await expect.poll(async()=>((await signedIn.evaluate(async()=>(await chrome.storage.local.get('settings')).settings)) as any).models.tab).toBe('claude-sonnet-5-5');
});

test('calls the gateway gzipped, streams the reply and reads its Server-Timing',async({signedIn,standin})=>{
 standin.script=()=>({text:'Hello there',firstMs:20});
 const result=await signedIn.evaluate(async()=>{const g=(globalThis as any).gumbo;let streamed='';const {message,timing}=await g.call({model:'claude-haiku-5-5',messages:[{role:'user',content:'Hi'}],max_tokens:16,purpose:'tab'},{onEvent:(e:any)=>{if(e.data?.delta?.text)streamed+=e.data.delta.text;}});return{text:message.content[0].text,streamed,timing};});
 expect(result.text).toBe('Hello there');expect(result.streamed).toBe('Hello there');
 expect(result.timing).toMatchObject({auth:4,reserve:12,provider:150});
 expect(standin.bodies[0]).toMatchObject({model:'claude-haiku-5-5',purpose:'tab',stream:true,max_tokens:16});expect(standin.bodies[0].requestId).toBeTruthy();
});
