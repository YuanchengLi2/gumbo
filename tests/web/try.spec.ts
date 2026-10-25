import {test,expect,type Page} from '@playwright/test';
import {codeGateway} from '../fixtures/code-gateway';

/** Trying Gumbo without an account (renderer/trial.ts, the web account's guest session): usegumbo.app/app/?try=1 offers
 * sample clips; the first request runs as a guest (an anonymous session, its token on every AI call); the next request
 * and exporting ask to sign in, saying why. */
const state=(page:Page)=>page.evaluate(()=>(window as any).dream.command({type:'state'}));

test('a try: a sample clip, one request as a guest, then sign in to keep going',async({page,context})=>{
 test.setTimeout(240_000);
 const gateway=await codeGateway({providers:{anthropic:true},script:()=>[{type:'text',text:'Done: a quick cut of the clips.'}]}),auth:string[]=[];let signups=0;
 try{
  await page.addInitScript(url=>{if(window!==window.top)return;localStorage.setItem('gumbo-cloud',JSON.stringify({url,anonKey:'fixture'}));localStorage.setItem('gumbo-onboarded','1');},gateway.url);
  await context.route('**/auth/v1/signup',route=>{signups++;return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({access_token:'guest-token',refresh_token:'guest-refresh',expires_in:3600,user:{id:'guest-1',is_anonymous:true}})});});
  await context.route('**/dream-gateway/ai',route=>{auth.push(route.request().headers().authorization??'');return route.continue();});
  await page.goto('/app/?try=1&prompt='+encodeURIComponent('Make it punchy'));
  await expect(page.getByText('Try Gumbo free: your first edit needs no account.')).toBeVisible({timeout:90_000});
  await expect(page).toHaveURL(/\/app\/$/);await expect(page.getByLabel('Ask Gumbo to edit')).toHaveValue('Make it punchy');

  // A sample's clips go into the box, once each, and its request is used only when the box is empty.
  const samples=page.getByRole('region',{name:'Sample clips'});await expect(samples.getByText('Gameplay: Dope Gameplays (CC BY)')).toBeVisible();
  await samples.getByRole('button',{name:/Skate session/}).click();
  await expect.poll(()=>page.locator('.home-composer .attachment-list > *').allTextContents(),{timeout:30_000}).toEqual(['skate-1.mp4','skate-2.mp4','skate-3.mp4']);
  await expect(page.getByLabel('Ask Gumbo to edit')).toHaveValue('Make it punchy');

  // The first request runs as a guest.
  await page.getByRole('button',{name:'Send prompt'}).click();
  await expect.poll(async()=>(await state(page).catch(()=>null))?.footage?.assets?.length,{timeout:90_000}).toBe(3);
  await expect.poll(()=>auth.length,{timeout:90_000}).toBeGreaterThan(0);
  expect(signups).toBe(1);expect(new Set(auth)).toEqual(new Set(['Bearer guest-token']));
  await expect.poll(async()=>(await state(page)).aiStatus,{timeout:90_000}).not.toBe('running');

  // The next one asks to sign in, saying the try was used; so does exporting.
  await page.getByLabel('Ask Gumbo to edit').fill('Now add captions');await page.getByRole('button',{name:'Send prompt'}).click();
  const signIn=page.getByRole('dialog',{name:'Sign in to Gumbo'});
  await expect(signIn.getByRole('heading',{name:'Keep going with a free account'})).toBeVisible();await expect(signIn.getByText('That was your free try.')).toBeVisible();
  await signIn.getByRole('button',{name:'Close sign-in'}).click();await expect(page.getByLabel('Ask Gumbo to edit')).toHaveValue('Now add captions');
  expect(signups).toBe(1);
 }finally{await gateway.close();}
});

test('signed in, a try link opens Gumbo as usual',async({page})=>{
 test.setTimeout(150_000);
 const gateway=await codeGateway({providers:{anthropic:true},script:()=>[]});
 try{
  await page.addInitScript(url=>{if(window!==window.top)return;localStorage.setItem('gumbo-cloud',JSON.stringify({url,anonKey:'fixture'}));localStorage.setItem('gumbo-onboarded','1');sessionStorage.setItem('gumbo-sign-in-verifier','fixture-verifier');},gateway.url);
  await page.goto('/app/?code=fixture-code');await expect(page.getByText('What are we cooking today?')).toBeVisible({timeout:90_000});
  await page.goto('/app/?try=1');await expect(page.getByText('What are we cooking today?')).toBeVisible({timeout:90_000});
  await expect(page.getByText('Try Gumbo free: your first edit needs no account.')).toHaveCount(0);await expect(page.getByRole('region',{name:'Sample clips'})).toHaveCount(0);
 }finally{await gateway.close();}
});

test('a try where Supabase refuses guests asks to sign in for the first edit, saying so',async({page,context})=>{
 test.setTimeout(150_000);
 const gateway=await codeGateway({providers:{anthropic:true},script:()=>[]});
 try{
  await page.addInitScript(url=>{if(window!==window.top)return;localStorage.setItem('gumbo-cloud',JSON.stringify({url,anonKey:'fixture'}));localStorage.setItem('gumbo-onboarded','1');},gateway.url);
  await context.route('**/auth/v1/signup',route=>route.fulfill({status:422,contentType:'application/json',body:JSON.stringify({code:422,error_code:'anonymous_provider_disabled',msg:'Anonymous sign-ins are disabled'})}));
  await page.goto('/app/?try=1&prompt='+encodeURIComponent('Make it punchy'));await expect(page.getByText('Try Gumbo free: your first edit needs no account.')).toBeVisible({timeout:90_000});
  await page.getByRole('button',{name:'Send prompt'}).click();
  const signIn=page.getByRole('dialog',{name:'Sign in to Gumbo'});await expect(signIn.getByRole('heading',{name:'Sign in to make your edit'})).toBeVisible();
  await expect(signIn.getByText('That was your free try.')).toHaveCount(0);
  expect(await page.evaluate(()=>localStorage.getItem('gumbo-try-used'))).toBeNull();
 }finally{await gateway.close();}
});
