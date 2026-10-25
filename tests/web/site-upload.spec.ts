import {test,expect} from '@playwright/test';
import {resolve} from 'node:path';
import {codeGateway} from '../fixtures/code-gateway';

/** The "+" on usegumbo.app's request bars: on October 24 it was only a drawing, so a friend's first request reached
 * Gumbo without the video they meant. Now the files picked there go along: the site copies them into the browser's
 * storage (assets/ask-files.js), the app opens with them in the home box, and they stay through the sign-in's round
 * trip until the project made from the request imports them. */
const fixture=resolve('artifacts/fixtures/source.mp4'),askFiles=resolve('sign-in-site/assets/ask-files.js');
const state=(page:import('@playwright/test').Page)=>page.evaluate(()=>(window as any).dream.command({type:'state'}));

test('a video added on the website goes into the project made from the request',async({page})=>{
 test.setTimeout(180_000);
 const gateway=await codeGateway({providers:{anthropic:true,google:true},script:(body)=>{
  if(!body.tools?.length)return [{type:'text',text:body.purpose==='shot_index'?'[]':'Fixture.'}];
  return [{type:'text',text:'Looked at the clip.'}];}});
 try{
  await page.addInitScript(url=>{if(window!==window.top)return;localStorage.setItem('gumbo-cloud',JSON.stringify({url,anonKey:'fixture'}));sessionStorage.setItem('gumbo-sign-in-verifier','fixture-verifier');},gateway.url);
  // The website's bar, on the same address as the app (as usegumbo.app and usegumbo.app/app are).
  await page.goto('/app/site-test-missing');
  await page.setContent(`<div class="ask" data-ask><form class="bar"><span class="plus" aria-hidden="true">+</span><textarea aria-label="Ask for any edit"></textarea><button class="send" type="submit" aria-label="Send">Send</button></form></div>`);
  await page.addScriptTag({path:askFiles});
  await page.evaluate(()=>{const ask=document.querySelector<HTMLElement>('[data-ask]')!,open=(window as any).gumboAsk(ask);
   ask.querySelector('form')!.addEventListener('submit',e=>{e.preventDefault();void open(ask.querySelector('textarea')!.value);});});
  const [chooser]=await Promise.all([page.waitForEvent('filechooser'),page.getByRole('button',{name:'Add your videos'}).click()]);
  await chooser.setFiles(fixture);
  await expect(page.getByText('source.mp4')).toBeVisible();
  await page.getByRole('textbox',{name:'Ask for any edit'}).fill('Make it set in India');
  await page.getByRole('button',{name:'Send'}).click();
  // It opens Gumbo ready to try without an account (renderer/trial.ts).
  await page.waitForURL(/\/app\/\?try=1&ask=.*&files=/);
  // The app has taken them from the address.
  await expect.poll(()=>page.evaluate(()=>location.search),{timeout:60_000}).toBe('');

  // The app takes them in; signing in leaves and comes back (here: the page's return with a code) and they are still there.
  await page.goto('/app/?code=fixture-code');
  await expect(page.getByText('What are we cooking today?')).toBeVisible({timeout:90_000});
  const box=page.getByRole('textbox',{name:'Ask Gumbo to edit'});
  await expect(page.locator('.home-composer .attachment-list')).toContainText('source.mp4');
  await box.fill('Make it set in India');
  await page.getByRole('button',{name:'Send prompt'}).click();
  await expect.poll(async()=>(await state(page))?.footage?.assets?.map((a:any)=>a.filename),{timeout:60_000}).toEqual(['source.mp4']);
  // Sent: the box no longer keeps them.
  expect(await page.evaluate(()=>sessionStorage.getItem('gumbo-home-paths'))).toBeNull();
 }finally{await gateway.close();}
});
