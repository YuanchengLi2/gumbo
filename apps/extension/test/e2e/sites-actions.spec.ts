import {test,expect,tell} from '../fixtures';
import type {Page,Frame} from '@playwright/test';

/** Tab for actions and Ctrl+K on real sites and web apps, logged out (GUMBO_SITES=1; needs the internet). For each: the
 * page is read the way the predictor reads it (the elements one can use, named), Tab's prediction runs on a real element
 * (typing into the site's own search or main field, read back), and Ctrl+K opens over the whole page and answers with
 * the page's text. The model is the stand-in: this checks the mechanics every prediction relies on, everywhere. Nothing
 * is submitted. */
type Site={name:string;url:string;field?:string};
const sites:Site[]=[
 {name:'Google',url:'https://www.google.com/',field:'textarea[name=q]'},
 {name:'Wikipedia article',url:'https://en.wikipedia.org/wiki/Tea',field:'input[name=search]'},
 {name:'YouTube',url:'https://www.youtube.com/',field:'input[name=search_query]'},
 {name:'GitHub repository',url:'https://github.com/microsoft/vscode'},
 {name:'Stack Overflow question',url:'https://stackoverflow.com/questions/11227809'},
 {name:'Amazon',url:'https://www.amazon.com/',field:'#twotabsearchtextbox'},
 {name:'Booking',url:'https://www.booking.com/',field:'input[name=ss]'},
 {name:'Airbnb',url:'https://www.airbnb.com/'},
 {name:'Reddit',url:'https://www.reddit.com/r/programming/'},
 {name:'Hacker News',url:'https://news.ycombinator.com/'},
 {name:'MDN',url:'https://developer.mozilla.org/en-US/docs/Web/JavaScript',field:'input[type=search]'},
 {name:'Google Translate',url:'https://translate.google.com/',field:'textarea'},
 {name:'TypeScript playground',url:'https://www.typescriptlang.org/play'},
 {name:'Lexical playground',url:'https://playground.lexical.dev/',field:'[contenteditable=true]'},
 {name:'CKEditor demo',url:'https://ckeditor.com/ckeditor-5/demo/feature-rich/',field:'.ck-editor__editable'},
 {name:'Gutenberg',url:'https://wordpress.org/gutenberg/'},
 {name:'Excalidraw',url:'https://excalidraw.com/'},
 {name:'Figma site',url:'https://www.figma.com/'},
 {name:'Notion site',url:'https://www.notion.com/'},
 {name:'Craigslist',url:'https://sfbay.craigslist.org/',field:'input[name=query]'},
];
const results:string[]=[];
test.describe.configure({mode:'serial'});
// Skipped before any browser starts unless asked for.
test.skip(!process.env.GUMBO_SITES,'Set GUMBO_SITES=1 to check real sites (needs the internet).');
test.afterAll(()=>{if(results.length)console.log('\nReal sites (actions and Ctrl+K):\n'+results.join('\n'));});
async function card(page:Page):Promise<Frame|undefined>{
 for(let i=0;i<40;i++){const f=page.frames().find(f=>f.url().includes('card.html'));if(f)return f;await page.waitForTimeout(100);}
}
for(const site of sites){
 test(`${site.name}: Tab reads the page and acts on it; Ctrl+K opens and answers`,async({page,signedIn,standin})=>{
  test.setTimeout(90_000);
  // The predictor's stand-in types into the field the cursor is in, by the id the page's listing gave it.
  standin.script=b=>{
   if(b.purpose==='inline')return{text:'ANSWER\nThis page is about what its title says.'};
   if(!/You are Gumbo's Tab/.test(JSON.stringify(b.system)))return{text:''};
   const sent=b.messages[0].content.map((c:any)=>c.text).join('\n'),cursor=/Their cursor is in (.+)\./.exec(sent)?.[1];
   const id=cursor&&new RegExp(`(e\\d+) \\w+ "${cursor.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}"`).exec(sent)?.[1];
   return{text:id?JSON.stringify({confidence:0.9,label:'Type the check',steps:[{do:'type',id,text:'gumbo tab'}]}):'{"confidence":0,"steps":[]}'};
  };
  try{await page.goto(site.url,{waitUntil:'domcontentloaded',timeout:30_000});await page.waitForTimeout(3500);}
  catch{results.push(`  ${site.name}: unreachable`);test.skip(true,'unreachable');return;}
  const fail=(what:string,detail='')=>{results.push(`  ${site.name}: FAILED ${what} ${detail}`);throw new Error(`${what} ${detail}`);};
  // 1. What the predictor sees: the elements one can use, named.
  const model=await tell(signedIn,page,{type:'page.model'});
  const named=(model?.items??[]).filter((i:any)=>i.name);
  if(named.length<5)fail('reading the page',`${named.length} named elements`);
  // 2. A step on a real element: typing into the site's own field, read back.
  let typed='no field';
  if(site.field){
   const field=page.locator(site.field).first();
   if(await field.isVisible().catch(()=>false)){
    await field.click().catch(()=>{});await page.waitForTimeout(300);
    const done=await tell(signedIn,page,{type:'act',action:{do:'type',text:'gumbo check'},anyFrame:true});
    if(!done?.ok)fail('typing a step',JSON.stringify(done));
    const read=await tell(signedIn,page,{type:'debug.field'});
    if(!String(read?.text??'').includes('gumbo check'))fail('reading the step back',JSON.stringify(read?.text?.slice?.(-60)));
    typed='typed and read back';
    // 2b. Tab's own guess, end to end: asked as the field took the cursor, shown, taken with Tab, typed in.
    await field.press('Control+a').catch(()=>{});await field.press('Backspace').catch(()=>{});
    await page.mouse.click(5,5).catch(()=>{});await field.click().catch(()=>{});
    const shown=await expect.poll(async()=>(await tell(signedIn,page,{type:'debug.predict'}))?.label,{timeout:10_000}).toBe('Type the check').then(()=>true,()=>false);
    if(shown){
     await page.keyboard.press('Tab');
     await expect.poll(async()=>String((await tell(signedIn,page,{type:'debug.field'}))?.text??''),{timeout:6000}).toContain('gumbo tab').catch(()=>fail('Tab running its guess'));
     typed+=', Tab guessed and typed';
    }else typed+=', no Tab guess (the cursor field was not named)';
   }
  }
  // 3. Ctrl+K over the whole page: the card opens (unless the site keeps Ctrl+K for itself), and answers.
  await page.mouse.click(5,5).catch(()=>{});await page.keyboard.press('Escape');
  await page.evaluate(()=>getSelection()?.removeAllRanges());
  await page.keyboard.press('Control+k');
  const frame=await card(page);let ctrlk='the site keeps Ctrl+K';
  if(frame){
   await frame.locator('#instruction').waitFor({timeout:5000}).catch(()=>fail('Ctrl+K card','did not render'));
   await page.keyboard.type('what is this page?');await page.keyboard.press('Enter');
   await expect(frame.locator('.body')).toContainText('what its title says',{timeout:10_000}).catch(()=>fail('Ctrl+K answer'));
   await page.keyboard.press('Escape');ctrlk='opened and answered';
  }
  results.push(`  ${site.name}: ok (${named.length} elements; ${typed}; Ctrl+K ${ctrlk})`);
 });
}
