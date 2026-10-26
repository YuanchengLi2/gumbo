/** Opens a test page headless and prints its console errors (for debugging a page that does not render). */
import {chromium} from '@playwright/test';
import {startStandin} from './standin';
const standin=await startStandin(),browser=await chromium.launch({headless:true}),page=await browser.newPage();
page.on('console',m=>{if(m.type()==='error'||m.type()==='warning')console.log(m.type(),m.text().slice(0,300));});page.on('pageerror',e=>console.log('pageerror',e.message.slice(0,400)));
await page.goto(`${standin.url}/pages/${process.argv[2]}`);await page.waitForTimeout(2500);
console.log(await page.evaluate(()=>document.getElementById('editor')?.innerHTML.slice(0,300)));
await browser.close();await standin.close();
