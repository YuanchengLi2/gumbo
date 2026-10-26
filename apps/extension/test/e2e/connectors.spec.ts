import {test,expect,extensionPage} from '../fixtures';

/** Connectors, end to end against stand-ins for the services: a token is checked before it is kept, kept sealed (never
 * readable in storage), offered to the agent as tools only once connected, and a write asks the user first. */
// Connections are parked for now (no UI to connect them): this waits until they come back.
test.skip('a pasted token connects Supabase; the agent reads with it, and a change waits for a yes',async({signedIn,standin,context})=>{
 await signedIn.evaluate(url=>chrome.storage.local.get('dev').then(({dev})=>chrome.storage.local.set({dev:{...(dev as object),connectors:url}})),standin.url);
 let call=0;
 standin.script=body=>{
  if(body.purpose!=='browser')return{text:''};
  call++;
  if(call===1)return{tools:[{name:'supabase_projects',input:{}}]};
  if(call===2)return{tools:[{name:'supabase_sql',input:{project:'abcd1234',sql:'select count(*) as signups from auth.users'}}]};
  if(call===3)return{tools:[{name:'supabase_sql',input:{project:'abcd1234',sql:'delete from auth.users where email is null'}}]};
  return{text:'You have 42 signups. I did not delete anything.'};
 };
 const popup=await context.newPage();await popup.goto(extensionPage('popup.html'));
 // A wrong token is refused and not kept.
 await popup.locator('.connection',{hasText:'Supabase'}).getByRole('button',{name:'Connect'}).click();
 await popup.getByPlaceholder('Supabase token').fill('sbp_wrong');await popup.getByRole('button',{name:'Save'}).click();
 await expect(popup.getByText(/did not accept that token/)).toBeVisible();
 await popup.getByPlaceholder('Supabase token').fill('sbp_fixture');await popup.getByRole('button',{name:'Save'}).click();
 await expect(popup.locator('.connection',{hasText:'Supabase'}).getByText('connected')).toBeVisible();
 // Sealed: the token is nowhere in readable storage.
 const stored=await signedIn.evaluate(async()=>JSON.stringify(await chrome.storage.local.get(null))+JSON.stringify(await chrome.storage.session.get(null)));
 expect(stored).not.toContain('sbp_fixture');
 const page=await context.newPage();await page.goto(`${standin.url}/pages/agent.html`);
 const panel=await context.newPage();await panel.goto(extensionPage('sidepanel.html'));
 const box=panel.getByPlaceholder(/Ask, or tell Gumbo/);await box.fill('How many signups do we have? Clean up users without email.');await box.press('Enter');
 await expect(panel.getByText(/Run this on abcd1234: delete from auth\.users/)).toBeVisible();
 await panel.getByRole('button',{name:'No'}).click();
 await expect(panel.getByText('You have 42 signups.',{exact:false})).toBeVisible();
 const queries=standin.services.filter(s=>s.path.endsWith('/database/query'));
 expect(queries.map(q=>q.body.query)).toEqual(['select count(*) as signups from auth.users']);
 const browserCalls=standin.bodies.filter(b=>b.purpose==='browser');
 expect(browserCalls[0].tools.map((t:any)=>t.name)).toEqual(expect.arrayContaining(['supabase_projects','supabase_sql']));
 expect(browserCalls[0].tools.map((t:any)=>t.name)).not.toContain('stripe_list');
});
