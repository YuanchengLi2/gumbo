import {test,expect,type Page} from '@playwright/test';

/** Music and sound effects on the web: composed in a web worker of the project worker (web-procedural-client.ts), written
 * into the project's folder in the browser's storage and imported as media, as the desktop does
 * with its worker thread. Before, every score and effect failed ("A background worker is not available"). */
const state=(page:Page)=>page.evaluate(()=>(window as any).dream.command({type:'state'}));

test('a score and a sound effect are composed in the browser',async({page})=>{
 test.setTimeout(180_000);
 const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
 const failures:string[]=[];
 await page.goto('/app/');await expect(page.getByText('What are we cooking today?')).toBeVisible({timeout:60_000});
 await page.evaluate(()=>(window as any).dream.createProject({requestId:'web-music',text:'',paths:[]}));
 await page.reload();await page.getByRole('button',{name:'Untitled project'}).first().click();
 await expect(page.getByText('Your canvas is ready')).toBeVisible({timeout:30_000});
 await page.exposeFunction('reportFailure',(message:string)=>failures.push(message));
 await page.evaluate(()=>(window as any).dream.onEvent((e:any)=>{if(e.type==='media.error')(window as any).reportFailure(e.payload?.message??'');}));

 const {scores,sfx}=await page.evaluate(()=>(window as any).dream.catalog());
 const version=(await state(page)).versionId;
 await page.evaluate(([score,effect,versionId])=>{const dream=(window as any).dream;
  void dream.command({type:'generate_music',presetId:score,durationSec:12,requestId:'web-music-score',expectedVersionId:versionId});
  void dream.command({type:'generate_sfx',presetId:effect,requestId:'web-music-sfx',expectedVersionId:versionId});},[scores[0].id,sfx[0].id,version]);

 // Both arrive as audio Gumbo made, with their sound on disk (an empty timeline gets nothing placed, as on the desktop).
 await expect.poll(async()=>(await state(page)).footage.assets.filter((a:any)=>a.kind==='audio'&&a.generated).length,{timeout:120_000}).toBeGreaterThanOrEqual(2);
 const s=await state(page);
 for(const a of s.footage.assets.filter((a:any)=>a.kind==='audio'))expect(a.durationSec).toBeGreaterThan(0);
 expect(failures).toEqual([]);expect(errors).toEqual([]);
});
