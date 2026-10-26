import {test,expect,tell} from '../fixtures';
import type {Page,Locator} from '@playwright/test';
import {ink,added,covered,count} from '../pixels';

/** The field engine on real sites, logged out (GUMBO_SITES=1; it needs the internet): search boxes, the editors sites
 * really run (Monaco, CodeMirror 5 and 6, Ace, Lexical, ProseMirror, Slate, Draft, Quill, CKEditor, TinyMCE, Trix,
 * Editor.js, Gutenberg) and a shadow DOM search. Each must read the text before the caret, draw the ghost exactly where
 * the accepted text lands, insert so the text reads back, and undo with Ctrl+Z. A site that does not load (or blocks
 * headless browsers) is reported as unreachable, not as a pass. Nothing is ever submitted or saved. */
type Site={name:string;url:string;focus:(p:Page)=>Locator;typed?:string;ghost?:string;region?:(p:Page)=>Locator;end?:boolean};
const search=(name:string,url:string,selector:string):Site=>({name,url,focus:p=>p.locator(selector).first(),typed:'cheap flights to',ghost:' Lisbon in May'});
const sites:Site[]=[
 search('Google','https://www.google.com/','textarea[name=q]'),
 search('Bing','https://www.bing.com/','#sb_form_q'),
 search('DuckDuckGo','https://duckduckgo.com/','input[name=q]'),
 search('Wikipedia','https://en.wikipedia.org/wiki/Main_Page','input[name=search]'),
 search('YouTube','https://www.youtube.com/','input[name=search_query]'),
 search('Reddit (shadow DOM)','https://www.reddit.com/','input[name=q]'),
 search('MDN','https://developer.mozilla.org/en-US/','input[type=search]'),
 search('Hacker News search','https://hn.algolia.com/','input[type=search]'),
 {name:'Google Translate',url:'https://translate.google.com/',focus:p=>p.locator('textarea').first()},
 {name:'TypeScript playground (Monaco)',url:'https://www.typescriptlang.org/play',focus:p=>p.locator('.monaco-editor .view-lines').first(),typed:'\n// Hello Sam, thanks for',ghost:' the notes',end:true},
 {name:'CodeMirror 6',url:'https://codemirror.net/try/',focus:p=>p.locator('.cm-content').first(),typed:'\n// Hello Sam, thanks for',ghost:' the notes',end:true},
 {name:'W3Schools (CodeMirror 5)',url:'https://www.w3schools.com/tryit/tryit.asp?filename=tryhtml_default',focus:p=>p.locator('.CodeMirror-lines').first(),typed:'\nHello Sam, thanks for',ghost:' the notes',end:true},
 {name:'Ace',url:'https://ace.c9.io/build/kitchen-sink.html',focus:p=>p.locator('.ace_content').first(),typed:'\n// Hello Sam, thanks for',ghost:' the notes',end:true},
 {name:'Lexical playground',url:'https://playground.lexical.dev/',focus:p=>p.locator('[contenteditable=true]').first(),end:true},
 {name:'ProseMirror',url:'https://prosemirror.net/',focus:p=>p.locator('.ProseMirror').first(),end:true},
 {name:'Slate',url:'https://www.slatejs.org/examples/richtext',focus:p=>p.locator('[data-slate-editor]').first(),end:true},
 {name:'Draft.js',url:'https://draftjs.org/',focus:p=>p.locator('.public-DraftEditor-content').first(),end:true},
 {name:'Quill',url:'https://quilljs.com/',focus:p=>p.locator('.ql-editor').first(),end:true},
 {name:'CKEditor 5',url:'https://ckeditor.com/ckeditor-5/demo/feature-rich/',focus:p=>p.locator('.ck-editor__editable').first(),end:true},
 {name:'TinyMCE',url:'https://www.tiny.cloud/docs/tinymce/latest/basic-example/',focus:p=>p.frameLocator('iframe.tox-edit-area__iframe').first().locator('body'),region:p=>p.locator('iframe.tox-edit-area__iframe').first(),end:true},
 {name:'Trix',url:'https://trix-editor.org/',focus:p=>p.locator('trix-editor').first(),end:true},
 {name:'Editor.js',url:'https://editorjs.io/',focus:p=>p.locator('.ce-paragraph[contenteditable=true]').first(),end:true},
 {name:'Gutenberg',url:'https://wordpress.org/gutenberg/',focus:p=>p.frameLocator('iframe[name=editor-canvas]').first().locator('p[contenteditable=true]').first(),region:p=>p.locator('iframe[name=editor-canvas]').first(),end:true},
];
const typedDefault=' Hello Sam, thanks for the notes from',ghostDefault=' our call today.';
const norm=(s:string)=>s.replace(/ /g,' ').replace(/\s+/g,' ').trim();
const results:string[]=[];
test.describe.configure({mode:'serial'});
// Skipped before any browser starts unless asked for.
test.skip(!process.env.GUMBO_SITES,'Set GUMBO_SITES=1 to check real sites (needs the internet).');
test.afterAll(()=>{if(results.length)console.log('\nReal sites:\n'+results.join('\n'));});

for(const site of sites){
 test(`${site.name}: reads, places the ghost where text lands, inserts, undoes`,async({page,worker,standin})=>{
  test.setTimeout(90_000);
  const words=site.typed??typedDefault,suggestion=site.ghost??ghostDefault;
  void standin;
  try{await page.goto(site.url,{waitUntil:'domcontentloaded',timeout:30_000});await site.focus(page).waitFor({state:'visible',timeout:20_000});}
  catch{results.push(`  ${site.name}: unreachable`);test.skip(true,'unreachable');return;}
  await page.waitForTimeout(1500);
  const field=site.focus(page);await field.click();
  if(site.end)await page.keyboard.press('Control+End');
  await page.keyboard.type(words,{delay:15});await page.waitForTimeout(1100);
  const step=(what:string,ok:boolean,detail='')=>{if(!ok)results.push(`  ${site.name}: FAILED ${what} ${detail}`);expect(ok,`${what} ${detail}`).toBe(true);};
  const read=await tell(worker,page,{type:'debug.field'});
  step('reading the field',!!read&&norm(read.before??'').endsWith(norm(words)),JSON.stringify(read?.before?.slice(-60)));
  const caret=read.caret;
  const region=site.region?(await site.region(page).boundingBox())!:null;
  const ox=region?.x??0,oy=region?.y??0;
  const clip={x:Math.max(0,ox+caret.x-500),y:Math.max(0,oy+caret.top-30),width:1000,height:Math.min(200,800-Math.max(0,oy+caret.top-30))};
  clip.width=Math.min(clip.width,1200-clip.x);
  const before=ink(await page.screenshot({clip}));
  const shown=await tell(worker,page,{type:'debug.ghost',text:suggestion});step('showing the ghost',!!shown?.ok,JSON.stringify(shown));
  const withGhost=ink(await page.screenshot({clip}));
  const inserted=await tell(worker,page,{type:'debug.insert',text:suggestion});step('inserting',!!inserted?.ok,JSON.stringify(inserted));
  await page.waitForTimeout(250);
  const after=ink(await page.screenshot({clip}));
  const ghostInk=added(withGhost,before),textInk=added(after,before);
  const overlap=Math.min(covered(ghostInk,textInk),covered(textInk,ghostInk));
  step('drawing the ghost',count(ghostInk)>30,`${count(ghostInk)} pixels`);
  step('ghost where the text lands',overlap>0.9,`overlap ${overlap.toFixed(3)}`);
  const now=await tell(worker,page,{type:'debug.field'});step('reading back',norm(now?.text??'').includes(norm(words+suggestion).slice(-30)),JSON.stringify(now?.before?.slice(-60)));
  await page.keyboard.press('Control+z');await page.waitForTimeout(250);
  const undone=await tell(worker,page,{type:'debug.field'});step('undo',!norm(undone?.before??'').endsWith(norm(suggestion)),JSON.stringify(undone?.before?.slice(-60)));
  results.push(`  ${site.name}: ok (${read.editor}, ${inserted.method}, overlap ${overlap.toFixed(3)})`);
 });
}
