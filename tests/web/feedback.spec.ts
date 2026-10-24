import {test,expect} from '@playwright/test';
import {codeGateway} from '../fixtures/code-gateway';

/** "Stumped or broken? Let me know" under the prompt box: signed out, a note and an email go to the gateway's feedback
 * (feedback.ts) with what the app was doing, and it says thanks. */
test('a note from under the prompt box, without an account',async({page})=>{
 test.setTimeout(150_000);
 const gateway=await codeGateway({providers:{anthropic:true},script:()=>[]}),sent:any[]=[];
 try{
  await page.addInitScript(url=>{if(window!==window.top)return;localStorage.setItem('gumbo-cloud',JSON.stringify({url,anonKey:'fixture'}));localStorage.setItem('gumbo-onboarded','1');},gateway.url);
  await page.route('**/dream-gateway/feedback',async route=>{sent.push({auth:route.request().headers().authorization,body:route.request().postDataJSON()});await route.fulfill({status:200,contentType:'application/json',body:'{"sent":true}'});});
  await page.goto('/app/');await expect(page.getByText('What are we cooking today?')).toBeVisible({timeout:90_000});
  await page.getByRole('button',{name:'Stumped or broken? Let me know'}).click();
  const box=page.getByRole('form',{name:'Send feedback'});await expect(box).toBeVisible();
  await expect(box.getByRole('button',{name:'Send'})).toBeDisabled();
  await box.getByLabel('What failed').fill('Add captions did nothing');await box.getByLabel('Your email (optional)').fill('sam@example.com');
  await box.getByRole('button',{name:'Send'}).click();
  await expect(box.getByText(/Thanks, got it\. I'll look into it and write back/)).toBeVisible();
  expect(sent).toHaveLength(1);expect(sent[0].auth).toBeUndefined();
  expect(sent[0].body).toMatchObject({note:'Add captions did nothing',email:'sam@example.com',appVersion:expect.any(String),platform:expect.stringMatching(/^web /),context:{route:'home',aiStatus:''}});
  await expect(box).toBeHidden({timeout:5000});
 }finally{await gateway.close();}
});
