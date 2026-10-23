import {test,expect} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import ffmpeg from 'ffmpeg-static';
import {session,use,state,text,images} from './roux-session';

/** Phase 5 of Gumbo on the web: coded scenes. Roux writes a card scene (a magenta box with text), which the project
 * service compiles with esbuild in the browser, and places it over the clip. The scene plays in the player, draws itself
 * into the frames Roux looks at, shows as a still on the timeline, and is in the exported video where it was placed. */
const scene="export default function Card({word,meaning}:{word:string;meaning:string}){\n return <div style={{position:'absolute',left:80,top:80,padding:'28px 40px',background:'#ff00ff',color:'white',fontSize:64,fontFamily:'sans-serif',borderRadius:16}}>{word} - {meaning}</div>;\n}\n";

test('a coded scene compiles, plays, is seen by Roux and is exported in the browser',async({page})=>{
 test.setTimeout(400_000);
 const run=await session(page,asset=>[
  [use('w','write_file',{path:'src/card.tsx',content:scene})],
  [use('e','edit_file',{path:'project.json',oldText:'"spine": [],',newText:`"spine": [{"id":"c1","assetId":"${asset}","srcIn":0,"srcOut":6,"speed":1,"audio":{"mute":true},"reason":"Clip"}],`})],
  [use('a','edit_file',{path:'project.json',oldText:'"attached": [],',newText:'"attached": [{"id":"card_o","type":"overlay","start":{"kind":"project","at":"start","offsetSec":0},"durationSec":6,"component":"source","params":{},"source":{"assetId":"output:card","srcIn":0,"srcOut":6},"layer":2,"reason":"Definition"}],'})],
  [use('o','edit_file',{path:'project.json',oldText:'"outputs": []',newText:'"outputs": [{"id":"card","path":"src/card.tsx","kind":"scene","durationInFrames":180,"transparent":true,"props":{"word":"Pho","meaning":"noodle soup"}}]'})],
  [use('p','publish_project',{})],
  [use('v','view_media',{target:'preview',times:[2,4]})],
  [use('f','finish',{status:'complete',summary:'Added the card.',evidence:[]})]]);
 try{
  await run.ask('Add a definition card.');
  const s=await state(page),card=s.footage.assets.find((a:any)=>a.scene);
  expect(card?.scene?.format).toBe('engine');
  // Roux's view: the frames drawn by the editor hold the card, which turns the top-left ninth magenta (blue far above
  // the red and green bars under it).
  expect(images(run.seen.v)).toBe(2);expect(text(run.seen.v)).toContain('card_o');
  const moments=JSON.parse(text(run.seen.v).split('\n')[0]).moments as {colours:{grid:string[]}}[];
  for(const m of moments)expect(parseInt(m.colours.grid[0].slice(5,7),16)).toBeGreaterThan(0x40);
  // The player shows the scene in its own page, and the timeline shows its still.
  await expect.poll(()=>page.locator('iframe[title]').count(),{timeout:30_000}).toBeGreaterThan(0);
  await page.getByRole('radio',{name:'Editor'}).click();
  await expect(page.locator('.scene-thumb').first()).toHaveAttribute('style',/data:image\/jpeg/,{timeout:60_000});
  // Exported, the card is where it was placed.
  await page.getByRole('button',{name:'Export'}).first().click();
  const dialog=page.getByRole('dialog',{name:'Export'});
  const [download]=await Promise.all([page.waitForEvent('download',{timeout:240_000}),dialog.getByRole('button',{name:'Export',exact:true}).click()]);
  const folder=mkdtempSync(join(tmpdir(),'gumbo-web-scene-')),saved=join(folder,download.suggestedFilename());
  try{
   await download.saveAs(saved);
   // Inside the card's padding, clear of its text.
   const pixel=execFileSync(ffmpeg!,['-v','error','-ss','3','-i',saved,'-frames:v','1','-vf','crop=8:8:90:90,scale=1:1','-f','rawvideo','-pix_fmt','rgb24','-']);
   expect(pixel[0]).toBeGreaterThan(200);expect(pixel[1]).toBeLessThan(80);expect(pixel[2]).toBeGreaterThan(200);
  }finally{rmSync(folder,{recursive:true,force:true});}
  expect(run.errors).toEqual([]);
 }finally{await run.gateway.close();}
});
