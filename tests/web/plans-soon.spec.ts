import {test,expect,type Page} from '@playwright/test';
import {codeGateway} from '../fixtures/code-gateway';

/** Before paying opens (the gateway's paymentsOpen, DREAM_PAYMENTS_OPEN), Settings and the upgrade window show the paid
 * plans and credit top-ups as coming soon: dimmed, nothing to buy. Once it opens, they can be bought. */
const plans=[{id:'free',name:'Free',priceUsd:0,credits:20},{id:'pro',name:'Pro',priceUsd:25,credits:1250},{id:'max',name:'Max',priceUsd:100,credits:4500},{id:'max20',name:'Max 20x',priceUsd:200,credits:18000}];
const billing=(open:boolean)=>({plan:'free',planName:'Free',status:null,cancelAtPeriodEnd:false,renewsAt:'2026-11-01T00:00:00Z',credits:{left:20,plan:20,planTotal:20,topups:0,overdraft:0},
 limits:{creatorSearches:10},usage:{creatorSearches:0},plans:plans.map(p=>({...p,limits:{creatorSearches:10}})),topup:{credits:500,priceUsd:10,maxPacks:10},payments:true,portal:false,paymentsOpen:open});
async function signedIn(page:Page,open:boolean){
 const gateway=await codeGateway({providers:{anthropic:true},script:()=>[]});
 await page.addInitScript(url=>{if(window!==window.top)return;localStorage.setItem('gumbo-cloud',JSON.stringify({url,anonKey:'fixture'}));sessionStorage.setItem('gumbo-sign-in-verifier','fixture-verifier');},gateway.url);
 await page.route('**/dream-gateway/billing',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(billing(open))}));
 await page.goto('/app/?code=fixture-code');await expect(page.getByText('What are we cooking today?')).toBeVisible({timeout:90_000});
 return gateway;
}
const shots=process.env.SHOTS_DIR;

test('paid plans and top-ups show as coming soon until paying opens',async({page})=>{
 test.setTimeout(180_000);
 const gateway=await signedIn(page,false);
 try{
  await page.getByRole('button',{name:'Profile'}).first().click();await page.getByRole('menuitem',{name:/Settings/}).or(page.getByRole('button',{name:/^Settings/})).first().click();
  await page.getByRole('button',{name:/^Plan$/}).first().click();
  const grid=page.locator('.plan-grid');
  await expect(grid.locator('.plan-option.soon')).toHaveCount(3);await expect(grid.getByText('Coming soon',{exact:true}).first()).toBeVisible();
  await expect(grid.getByRole('button',{name:/Get /})).toHaveCount(0);
  if(shots)await page.screenshot({path:`${shots}/settings-plan.png`});
  await page.getByRole('button',{name:/^Usage|^Credits/}).first().click();
  await expect(page.locator('.topup-card.soon')).toBeVisible();await expect(page.getByRole('button',{name:'Buy credits'})).toHaveCount(0);
  if(shots)await page.screenshot({path:`${shots}/settings-usage.png`});
  await page.keyboard.press('Escape');
  await page.getByRole('button',{name:'Upgrade plan'}).click();
  const dialog=page.getByRole('dialog',{name:/plan/i});
  await expect(dialog.locator('.upgrade-plan.soon')).toHaveCount(2);await expect(dialog.getByRole('button',{name:/Get |Buy /})).toHaveCount(0);
  await expect(dialog.getByText('Paid plans and credit top-ups are coming soon.',{exact:false})).toBeVisible();
  if(shots)await page.screenshot({path:`${shots}/upgrade-window.png`});
 }finally{await gateway.close();}
});

test('once paying opens, plans can be bought',async({page})=>{
 test.setTimeout(180_000);
 const gateway=await signedIn(page,true);
 try{
  await page.getByRole('button',{name:'Upgrade plan'}).click();
  const dialog=page.getByRole('dialog',{name:/plan/i});
  await expect(dialog.getByRole('button',{name:'Get Pro'})).toBeEnabled();await expect(dialog.locator('.soon')).toHaveCount(0);
 }finally{await gateway.close();}
});
