import {test,expect,_electron as electron,type ElectronApplication,type Page} from '@playwright/test';
import {createServer} from 'node:http';
import {mkdtempSync,writeFileSync,readFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {signIn} from '../fixtures/code-gateway';

/** The first-run onboarding (components/onboarding), the plans, and the welcome to a plan, in the packaged app. A test run
 * hides the onboarding (DREAM_HEADLESS) unless it asks for it (DREAM_ONBOARDING). Saves each screen to
 * test-results/onboarding. */
const EMAIL='new@example.invalid';
const names:Record<string,string>={free:'Free',pro:'Pro',max:'Max',max20:'Max 20x'},amounts:Record<string,number>={free:100,pro:900,max:4500,max20:18000},prices:Record<string,number>={free:0,pro:30,max:100,max20:200};
const billing=(plan:string)=>({plan,planName:names[plan],status:plan==='free'?null:'active',cancelAtPeriodEnd:false,renewsAt:'2026-11-18T12:00:00.000Z',
 credits:{left:amounts[plan],plan:amounts[plan],planTotal:amounts[plan],topups:0,overdraft:0},plans:Object.keys(names).map(id=>({id,name:names[id],priceUsd:prices[id],credits:amounts[id]})),
 topup:{credits:500,priceUsd:10,maxPacks:10},payments:true,portal:plan!=='free'});

/** The parts of Gumbo's service the onboarding uses: sign-in, the account, its plan, and its onboarding answers. */
async function accountService(){
 const state={plan:'free',profile:null as null|Record<string,unknown>,posts:[] as Record<string,unknown>[]};
 const server=createServer(async(req,res)=>{
  const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
  const path=(req.url??'').split('?')[0],json=(status:number,data:unknown)=>res.writeHead(status,{'Content-Type':'application/json'}).end(JSON.stringify(data));
  if(path.startsWith('/auth/v1/'))return json(200,{access_token:'onboarding-fixture',refresh_token:'onboarding-refresh',expires_in:3600,user:{id:'fixture-account',email:EMAIL,is_anonymous:false}});
  if(path.endsWith('/account'))return json(200,{email:EMAIL,status:'active',plan:state.plan});
  if(path.endsWith('/billing'))return json(200,billing(state.plan));
  if(path.endsWith('/profile')){
   if(req.method==='POST'){const body=JSON.parse(Buffer.concat(chunks).toString());state.posts.push(body);state.profile={...body,onboardedAt:state.profile?.onboardedAt??'2026-10-18T12:00:00.000Z'};return json(200,{saved:true});}
   return json(200,state.profile??{name:'',makes:[],experience:null,heard:null,onboardedAt:null});
  }
  return json(404,{});
 });
 await new Promise<void>(done=>server.listen(0,'127.0.0.1',()=>done()));
 return{url:`http://127.0.0.1:${(server.address() as {port:number}).port}`,state,close:()=>new Promise<void>(done=>server.close(()=>done()))};
}

const out=resolve('test-results/onboarding');
async function start(service:{url:string},profile=mkdtempSync(join(tmpdir(),'dream-onboarding-profile-')),onboarding=true){
 writeFileSync(join(profile,'cloud.json'),JSON.stringify({url:service.url,anonKey:'fixture'}));mkdirSync(out,{recursive:true});
 const app=await electron.launch({executablePath:resolve(process.env.DREAM_PACKAGE_EXECUTABLE??'apps/desktop/out/Dream-win32-x64/Dream.exe'),args:[`--user-data-dir=${profile}`],env:{...process.env,DREAM_HEADLESS:'1',DREAM_DOCUMENTS_DIRECTORY:profile,...(onboarding?{DREAM_ONBOARDING:'1'}:{})}});
 const page=await app.firstWindow(),errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].showInactive());
 return{app,page,errors,profile};
}
const shot=async(page:Page,name:string)=>{await page.waitForTimeout(250);await page.screenshot({path:join(out,name+'.png')});};
const saved=(profile:string)=>JSON.parse(readFileSync(join(profile,'settings.json'),'utf8')).profile;
const stored=(page:Page,key:string)=>page.evaluate(k=>localStorage.getItem(k),key);
/** What main tells the window when Stripe's window closes. */
const billingReturned=(app:ElectronApplication,status:string)=>app.evaluate(({BrowserWindow},status)=>BrowserWindow.getAllWindows()[0].webContents.send('dream:event',{type:'billing.returned',payload:{status}}),status);

test('A new user answers before signing in, starts from a fitted request, and the answers reach the account at sign-in',async()=>{
 const service=await accountService();let run=await start(service);
 try{
  const {page}=run,onboarding=page.getByRole('dialog',{name:'Welcome to Gumbo'});
  await expect(onboarding.getByRole('heading',{name:'Welcome to Gumbo'})).toBeVisible();await shot(page,'01-welcome');
  await onboarding.getByRole('button',{name:'Get started'}).click();
  await expect(onboarding.getByRole('heading',{name:'Create your account'})).toBeVisible();await shot(page,'02-account');
  await onboarding.getByRole('button',{name:/Skip for now/}).click();
  await expect(onboarding.getByRole('heading',{name:'What should Gumbo call you?'})).toBeVisible();
  await expect(onboarding.getByRole('button',{name:'Continue'})).toBeDisabled();
  await onboarding.getByLabel('Your name').fill('Ada Lovelace');await shot(page,'03-name');await onboarding.getByLabel('Your name').press('Enter');
  await expect(onboarding.getByRole('heading',{name:'What do you make, Ada?'})).toBeVisible();
  for(const make of ['YouTube videos','Podcasts and interviews'])await onboarding.getByRole('button',{name:make}).click();
  await expect(onboarding.getByRole('button',{name:'YouTube videos'})).toHaveAttribute('aria-pressed','true');await shot(page,'04-makes');
  await onboarding.getByRole('button',{name:'Continue'}).click();
  await expect(onboarding.getByRole('heading',{name:'How much have you edited?'})).toBeVisible();await shot(page,'05-experience');
  await onboarding.getByRole('radio',{name:/I edit a lot/}).click();
  await expect(onboarding.getByRole('heading',{name:'How did you hear about Gumbo?'})).toBeVisible();await shot(page,'06-heard');
  await onboarding.getByRole('radio',{name:'Reddit'}).click();
  // Signed out, so no plans: straight to requests fitted to what they make.
  await expect(onboarding.getByRole('heading',{name:/all set, Ada/})).toBeVisible();
  await expect(onboarding.getByRole('button',{name:/YouTube video/})).toBeVisible();await expect(onboarding.getByRole('button',{name:/Podcast clips/})).toBeVisible();await shot(page,'07-ready');
  expect(saved(run.profile)).toEqual({name:'Ada Lovelace',makes:'YouTube videos, Podcasts and interviews',style:''});
  expect(await stored(page,'gumbo-onboarding-unsent')).toBe('1');expect(service.state.posts).toEqual([]);
  // A request picked here waits in the home screen's box, under a greeting with the name.
  await onboarding.getByRole('button',{name:/Podcast clips/}).click();await expect(onboarding).toHaveCount(0);
  await expect(page.locator('.fig-home .home-composer textarea')).toHaveValue(/three best moments in this podcast/);
  await expect(page.getByRole('heading',{name:'What are we cooking today, Ada?'})).toBeVisible();await shot(page,'08-home');
  expect(await stored(page,'gumbo-onboarded')).toBe('1');
  // Signing in later sends the answers to the account.
  await signIn(page);
  await expect.poll(()=>service.state.posts).toEqual([{name:'Ada Lovelace',makes:['youtube','podcasts'],experience:'pro',heard:'reddit'}]);
  await expect.poll(()=>stored(page,'gumbo-onboarding-unsent')).toBeNull();
  expect(run.errors).toEqual([]);
  // The next start goes straight home, still greeting Ada.
  await run.app.close();run=await start(service,run.profile,false);
  await expect(run.page.getByRole('heading',{name:'What are we cooking today, Ada?'})).toBeVisible();
  await expect(run.page.getByRole('dialog',{name:'Welcome to Gumbo'})).toHaveCount(0);expect(await stored(run.page,'gumbo-onboarded')).toBe('1');
 }finally{await run.app.close();await service.close();}
});

test('Signing in during the onboarding offers the plans; a first plan and a bigger one each open their welcome',async()=>{
 const service=await accountService(),run=await start(service);
 try{
  const {page,app}=run,onboarding=page.getByRole('dialog',{name:'Welcome to Gumbo'});
  await onboarding.getByRole('button',{name:'Get started'}).click();
  await onboarding.getByRole('button',{name:'Sign in with your browser'}).click();
  await expect(onboarding).toContainText('Waiting for you to sign in');await shot(page,'09-waiting');
  await signIn(page);
  await expect(onboarding.getByRole('heading',{name:'What should Gumbo call you?'})).toBeVisible();
  await onboarding.getByLabel('Your name').fill('Lin');await onboarding.getByRole('button',{name:'Continue'}).click();
  await onboarding.getByRole('button',{name:'Gaming'}).click();await onboarding.getByRole('button',{name:'Continue'}).click();
  await onboarding.getByRole('radio',{name:/New to editing/}).click();
  await onboarding.getByRole('button',{name:'Skip'}).click();
  await expect.poll(()=>service.state.posts).toEqual([{name:'Lin',makes:['gaming'],experience:'new'}]);
  // The plans, as Claude shows them: Free to carry on with, Pro, and Max with its two sizes.
  await expect(onboarding.getByRole('heading',{name:'Choose your plan'})).toBeVisible();
  await expect(onboarding.getByRole('button',{name:'Get Pro'})).toBeVisible();await expect(onboarding.getByRole('button',{name:'Get Max'})).toBeVisible();await shot(page,'10-plans');
  await onboarding.getByRole('radio',{name:'20x'}).click();await expect(onboarding.getByRole('button',{name:'Get Max 20x'})).toBeVisible();
  await expect(onboarding).toContainText('$200');
  await onboarding.getByRole('button',{name:'Continue with Free'}).click();
  await expect(onboarding.getByRole('heading',{name:/all set, Lin/})).toBeVisible();await expect(onboarding.getByRole('button',{name:/Gaming highlights/})).toBeVisible();
  await onboarding.getByRole('button',{name:'Start creating'}).click();await expect(onboarding).toHaveCount(0);
  // This computer has seen the account on Free, so a plan bought now is new.
  await expect.poll(()=>stored(page,'gumbo-plan:'+EMAIL)).toBe('free');
  service.state.plan='pro';await billingReturned(app,'subscribed');
  const welcome=page.getByRole('dialog',{name:'Welcome to Pro'});
  await expect(welcome.getByRole('heading',{name:'Welcome to Gumbo Pro'})).toBeVisible();await expect(welcome).toContainText('900 credits every month');await shot(page,'11-welcome-pro');
  await welcome.getByRole('button',{name:'Continue'}).click();
  await expect(welcome.getByRole('heading',{name:'Get the most from your credits'})).toBeVisible();await shot(page,'12-welcome-tips');
  await welcome.getByRole('button',{name:'Continue'}).click();
  await expect(welcome.getByRole('heading',{name:'Start your first Pro edit'})).toBeVisible();await shot(page,'13-welcome-start');
  await welcome.getByRole('button',{name:/Gaming highlights/}).click();await expect(welcome).toHaveCount(0);
  await expect(page.locator('.fig-home .home-composer textarea')).toHaveValue(/best plays and funniest moments/);
  // Pro to Max: the upgrade window shows Pro as the plan and Max to move up to; the change lands through Stripe's page.
  await page.getByRole('button',{name:'Upgrade plan'}).click();
  const upgrade=page.getByRole('dialog',{name:'Upgrade your plan'});
  await expect(upgrade.getByRole('button',{name:'Upgrade to Max'})).toBeVisible();await expect(upgrade).toContainText('Your plan');await shot(page,'14-upgrade');
  await page.keyboard.press('Escape');await expect(upgrade).toHaveCount(0);
  service.state.plan='max';await billingReturned(app,'portal');
  const max=page.getByRole('dialog',{name:'Welcome to Max'});
  await expect(max.getByRole('heading',{name:'You’re on Max now'})).toBeVisible();await expect(max.getByRole('button',{name:'Continue'})).toHaveCount(0);await shot(page,'15-welcome-max');
  await max.getByRole('button',{name:'Start creating'}).click();await expect(max).toHaveCount(0);
  expect(run.errors).toEqual([]);
 }finally{await run.app.close();await service.close();}
});

test('An account that answered on another computer is welcomed back without the questions',async()=>{
 const service=await accountService();service.state.profile={name:'Grace Hopper',makes:['gaming'],experience:'pro',heard:'x',onboardedAt:'2026-10-01T00:00:00.000Z'};
 const run=await start(service);
 try{
  const {page}=run,onboarding=page.getByRole('dialog',{name:'Welcome to Gumbo'});
  await onboarding.getByRole('button',{name:'Get started'}).click();await onboarding.getByRole('button',{name:'Sign in with your browser'}).click();await signIn(page);
  await expect(onboarding.getByRole('heading',{name:'Welcome back, Grace'})).toBeVisible();await expect(onboarding.getByRole('button',{name:'Back'})).toHaveCount(0);await shot(page,'16-welcome-back');
  await expect.poll(()=>saved(run.profile)).toMatchObject({name:'Grace Hopper',makes:'Gaming'});expect(service.state.posts).toEqual([]);
  await onboarding.getByRole('button',{name:'Start creating'}).click();await expect(page.getByRole('heading',{name:'What are we cooking today, Grace?'})).toBeVisible();
  expect(run.errors).toEqual([]);
 }finally{await run.app.close();await service.close();}
});
