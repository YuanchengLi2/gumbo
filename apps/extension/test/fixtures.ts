/** Playwright fixtures: headless Chromium with the built extension (dist/) loaded, pointed at a stand-in for the gateway
 * and sign-in, and optionally signed in. No window opens; nothing costs money. */
import {test as base,chromium,type BrowserContext,type Worker,type Page} from '@playwright/test';
import {resolve} from 'node:path';
import {startStandin,type Standin} from './standin';
export const dist=resolve(import.meta.dirname,'../dist');
export const EXTENSION_ID='cikfcoahiibaldfbafkcnolkdknjnelp';
type Fixtures={standin:Standin;context:BrowserContext;worker:Worker;signedIn:Worker;page:Page};
export const test=base.extend<Fixtures>({
 standin:async({},use)=>{const standin=await startStandin();await use(standin);await standin.close();},
 context:async({},use)=>{
  const context=await chromium.launchPersistentContext('',{channel:'chromium',headless:true,args:[`--disable-extensions-except=${dist}`,`--load-extension=${dist}`],viewport:{width:1200,height:800}});
  await use(context);await context.close();
 },
 worker:async({context,standin},use)=>{
  let [worker]=context.serviceWorkers();worker??=await context.waitForEvent('serviceworker');
  await worker.evaluate(url=>chrome.storage.local.set({dev:{supabase:url}}),standin.url);
  await use(worker);
 },
 signedIn:async({worker},use)=>{
  await worker.evaluate(()=>chrome.storage.local.set({session:{access_token:'fixture-access',refresh_token:'fixture-refresh',expires_at:Math.floor(Date.now()/1000)+3600,user:{id:'fixture-user',email:'friend@example.com'}}}));
  await use(worker);
 },
 page:async({context},use)=>{const page=await context.newPage();await use(page);},
});
export {expect} from '@playwright/test';
/** The extension's own pages, by name. */
export const extensionPage=(name:string)=>`chrome-extension://${EXTENSION_ID}/${name}`;

/** Sends a request to the content scripts of a page's tab; null when no frame answers. */
export async function tell(worker:Worker,page:Page,message:unknown):Promise<any>{
 return worker.evaluate(async({url,message})=>{const [tab]=await chrome.tabs.query({url});try{return await (globalThis as any).gumbo.send(tab.id,message);}catch{return null;}},{url:page.url().split('#')[0],message});
}
