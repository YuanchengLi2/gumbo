import {chromium,type Worker,type Page} from '@playwright/test';
import {test,expect,dist,extensionPage} from '../fixtures';
import type {Standin} from '../standin';

/** Memory sync between two computers: two browser profiles with the extension, signed in to the same account, against
 * the stand-in gateway. Sync is turned on in the first one's popup with a passphrase (its recovery note shown first);
 * the second enters it (a wrong one is refused); memory written on either shows up, opened, on the other, and what is
 * forgotten on one is forgotten on both. The stand-in holds only ciphertext throughout. */
const PASSPHRASE='lantern orchard 4417 quietly';
const syncNow=(w:Worker)=>w.evaluate(async()=>{const g=(globalThis as any).gumbo;await g.sync.now();return g.sync.state();});
const notes=(w:Worker)=>w.evaluate(async()=>((await (globalThis as any).gumbo.db.recent('notes',50)) as any[]).map(n=>n.text));
const pages=(w:Worker)=>w.evaluate(async()=>((await (globalThis as any).gumbo.db.recent('pages',50)) as any[]).map(p=>({url:p.url,title:p.title})));
const remember=(w:Worker,note:string)=>w.evaluate(text=>(globalThis as any).gumbo.importAssistantMemory(text),note);
/** What the stand-in server holds for the account: its key profile, the rows' fields, and every payload's bytes. */
const held=(standin:Standin)=>{const a=standin.sync.get('fixture-user');return a?[JSON.stringify(a.profile),...[...a.rows.values()].map(r=>Buffer.from(r.payload,'base64').toString('latin1'))].join('\n'):'';};
const unreadable=(standin:Standin,secrets:string[])=>{const all=held(standin);for(const secret of secrets)expect(all,`the server holds "${secret}"`).not.toContain(secret);};

async function secondComputer(standin:Standin){
 const context=await chromium.launchPersistentContext('',{channel:'chromium',headless:true,args:[`--disable-extensions-except=${dist}`,`--load-extension=${dist}`],viewport:{width:1200,height:800}});
 let [worker]=context.serviceWorkers();worker??=await context.waitForEvent('serviceworker');
 await worker.evaluate(url=>chrome.storage.local.set({dev:{supabase:url},session:{access_token:'fixture-access',refresh_token:'fixture-refresh',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'fixture-user',email:'friend@example.com'}}}),standin.url);
 return{context,worker};
}
const popup=async(page:Page)=>{await page.goto(extensionPage('popup.html'));await expect(page.getByRole('heading',{name:'Sync'})).toBeVisible({timeout:15_000});};
const synced=(page:Page)=>expect(page.getByText(/^Synced (just now|\d+ min ago)/)).toBeVisible({timeout:30_000});

test('memory written on one computer shows up on the other, and the server holds only ciphertext',async({signedIn:a,page,standin})=>{
 test.setTimeout(120_000);
 await a.evaluate(async()=>{const g=(globalThis as any).gumbo;await g.capture({url:'https://example.com/lease',title:'Lease terms for 4B',text:'The rent for apartment 4B is due on the first of each month, paid to Harbor Property Management. '.repeat(12)});});
 await remember(a,'Dana prefers morning calls');

 // Turned on in the first computer's popup: the recovery note comes before anything is made.
 await popup(page);
 await page.getByRole('button',{name:'Turn on sync'}).click();
 await page.getByLabel('Sync passphrase',{exact:true}).fill(PASSPHRASE);
 await page.getByLabel('Sync passphrase again').fill(PASSPHRASE+'!');
 await page.getByRole('button',{name:'Continue'}).click();
 await expect(page.getByText('The two passphrases are not the same.')).toBeVisible();
 await page.getByLabel('Sync passphrase again').fill(PASSPHRASE);
 await page.getByRole('button',{name:'Continue'}).click();
 await expect(page.getByLabel('Recovery note')).toContainText(PASSPHRASE);
 await expect(page.getByLabel('Recovery note')).toContainText('friend@example.com');
 expect(standin.sync.size).toBe(0);
 await page.getByRole('button',{name:'I saved it, turn on sync'}).click();
 await synced(page);
 await expect(page.getByRole('heading',{name:'Memory, on your computers'})).toBeVisible();
 expect(await syncNow(a)).toMatchObject({on:true,pending:0,changed:false});

 // The server has the page and the note, sealed: nothing readable, not even what kind of record each is.
 const account=standin.sync.get('fixture-user')!;
 expect(account.rows.size).toBe(2);
 expect(Object.keys(account.profile).sort()).toEqual(['bytes','kdf','key_id','salt','verifier']);
 for(const row of account.rows.values())expect(Object.keys(row).sort()).toEqual(['at','device','payload','seq','sid','size','version']);
 unreadable(standin,['example.com','Lease terms','apartment','Harbor','Dana prefers','morning','notes','pages',PASSPHRASE,'lantern']);

 const b=await secondComputer(standin);
 try{
  const there=await b.context.newPage();await popup(there);
  await expect(there.getByText('Your memory syncs on another computer. Enter its passphrase to bring it here.')).toBeVisible();
  await there.getByRole('button',{name:'Enter passphrase'}).click();
  await there.getByLabel('Sync passphrase',{exact:true}).fill('lantern orchard 4417 loudly');
  await there.getByRole('button',{name:'Bring my memory here'}).click();
  await expect(there.getByText('That passphrase doesn’t open your synced memory.')).toBeVisible({timeout:15_000});
  expect(await notes(b.worker)).toEqual([]);
  await there.getByLabel('Sync passphrase',{exact:true}).fill(PASSPHRASE);
  await there.getByRole('button',{name:'Bring my memory here'}).click();
  await synced(there);
  await syncNow(b.worker);

  // Opened on the second computer, and searchable there (its passages were cut again where it arrived).
  expect(await notes(b.worker)).toContain('Dana prefers morning calls');
  expect(await pages(b.worker)).toEqual([{url:'https://example.com/lease',title:'Lease terms for 4B'}]);
  const found:any[]=await b.worker.evaluate(q=>(globalThis as any).gumbo.search(q,{k:3}),'when is the rent due for 4B');
  expect(found.some(f=>f.url==='https://example.com/lease')).toBe(true);

  // Written on the second computer, it reaches the first.
  await remember(b.worker,'The spare keys are with the neighbor in 4C');
  await syncNow(b.worker);await syncNow(a);
  expect(await notes(a)).toContain('The spare keys are with the neighbor in 4C');

  // Forgotten on the second computer, it is forgotten on the first too.
  await there.evaluate(()=>chrome.runtime.sendMessage({type:'memory.forget',site:'example.com'}));
  await syncNow(b.worker);await syncNow(a);
  expect(await pages(a)).toEqual([]);
  expect(await notes(a)).toContain('Dana prefers morning calls');
  expect(account.rows.size).toBe(3);
  unreadable(standin,['example.com','neighbor','spare keys','Dana prefers']);
 }finally{await b.context.close();}
});
