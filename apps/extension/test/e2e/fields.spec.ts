import {test,expect,tell} from '../fixtures';
import type {Page,Locator} from '@playwright/test';
import {ink,added,covered,count} from '../pixels';
import {buildPages} from '../pages/build';

/** The field engine on every editor library: the text around the caret reads right, ghost text is drawn exactly where
 * the accepted text then lands (compared pixel by pixel), insertion reads back and Ctrl+Z undoes it, and sensitive
 * fields never answer. */
test.beforeAll(async()=>{await buildPages();});

type Case={name:string;page:string;editor:string;focus:(page:Page)=>Locator;region?:(page:Page)=>Locator;typed?:string;ghost?:string;undo?:boolean};
const typed='Hello Sam, thanks for the notes from';
const ghost=' our call today. I will send the slides by Friday morning so we can go through them together before the review.';
const cases:Case[]=[
 {name:'textarea',page:'plain.html',editor:'textarea',focus:p=>p.locator('#ta')},
 {name:'input',page:'plain.html',editor:'input',focus:p=>p.locator('#in'),ghost:' our call'},
 {name:'contenteditable',page:'plain.html',editor:'contenteditable',focus:p=>p.locator('#ce')},
 {name:'scaled textarea',page:'plain.html',editor:'textarea',focus:p=>p.locator('#scaled')},
 {name:'shadow DOM textarea',page:'plain.html',editor:'textarea',focus:p=>p.locator('#shadow-ta')},
 {name:'right to left',page:'plain.html',editor:'contenteditable',focus:p=>p.locator('#rtl'),typed:'שלום דנה, תודה על',ghost:' הסיכום מהפגישה של היום.'},
 {name:'ProseMirror (TipTap)',page:'build/tiptap.html',editor:'prosemirror',focus:p=>p.locator('.ProseMirror')},
 {name:'Lexical',page:'build/lexical.html',editor:'lexical',focus:p=>p.locator('#editor')},
 {name:'Slate',page:'build/slate.html',editor:'slate',focus:p=>p.locator('[data-slate-editor]')},
 {name:'Draft.js',page:'build/draft.html',editor:'draft',focus:p=>p.locator('.public-DraftEditor-content')},
 {name:'Quill',page:'build/quill.html',editor:'quill',focus:p=>p.locator('.ql-editor')},
 {name:'CodeMirror 6',page:'build/codemirror.html',editor:'codemirror',focus:p=>p.locator('.cm-content')},
 {name:'CKEditor 5',page:'build/ckeditor.html',editor:'ckeditor',focus:p=>p.locator('.ck-editor__editable')},
 {name:'TinyMCE',page:'tinymce.html',editor:'tinymce',focus:p=>p.frameLocator('iframe').locator('body'),region:p=>p.locator('iframe')},
 {name:'Monaco',page:'build/monaco.html',editor:'monaco',focus:p=>p.locator('.monaco-editor .view-lines'),region:p=>p.locator('#editor'),ghost:' our call today.'},
];
const norm=(s:string)=>s.replace(/ /g,' ').replace(/\s+/g,' ').trim();

for(const c of cases){
 test(`${c.name}: reads, places the ghost where text lands, inserts, undoes`,async({page,worker,standin})=>{
  const words=c.typed??typed,suggestion=c.ghost??ghost;
  await page.goto(`${standin.url}/pages/${c.page}`);
  const field=c.focus(page);await field.waitFor();await field.click();
  await page.keyboard.type(words);
  // Editors that group quick edits into one undo step get a pause, as a person's would be before accepting.
  await page.waitForTimeout(1100);
  const read=await tell(worker,page,{type:'debug.field'});if(process.env.GUMBO_DEBUG)console.log(JSON.stringify({after:read?.after,before:read?.before?.slice(-40),caret:read?.caret}));
  expect(read,'the focused frame answers').toBeTruthy();expect(read.editor).toBe(c.editor);
  expect(norm(read.before).endsWith(norm(words))).toBe(true);
  const region=(c.region??c.focus)(page),box=(await region.boundingBox())!;
  const clip={x:Math.max(0,box.x-4),y:Math.max(0,box.y-4),width:Math.min(1180,box.width+8),height:Math.min(760,box.height+120)};
  const before=ink(await page.screenshot({clip}));
  const shown=await tell(worker,page,{type:'debug.ghost',text:suggestion});expect(shown.ok).toBe(true);expect(shown.mode).toBe('inline');
  const ghostShot=await page.screenshot({clip}),withGhost=ink(ghostShot);
  const inserted=await tell(worker,page,{type:'debug.insert',text:suggestion});expect(inserted.ok,JSON.stringify(inserted)).toBe(true);
  await page.waitForTimeout(150);
  const afterShot=await page.screenshot({clip}),after=ink(afterShot);
  if(process.env.GUMBO_DEBUG){const {writeFileSync,mkdirSync}=await import('node:fs');mkdirSync('test-results/shots',{recursive:true});writeFileSync(`test-results/shots/${c.editor}-ghost.png`,ghostShot);writeFileSync(`test-results/shots/${c.editor}-after.png`,afterShot);}
  const ghostInk=added(withGhost,before),textInk=added(after,before);
  expect(count(ghostInk),'the ghost drew something').toBeGreaterThan(50);
  const a=covered(ghostInk,textInk),b=covered(textInk,ghostInk);
  expect(Math.min(a,b),`ghost and inserted text overlap (ghost covered ${a.toFixed(3)}, text covered ${b.toFixed(3)}) via ${inserted.method}`).toBeGreaterThan(0.92);
  const now=await tell(worker,page,{type:'debug.field'});expect(norm(now.text).endsWith(norm(words+suggestion))).toBe(true);
  if(c.undo!==false){
   await page.keyboard.press('Control+z');await page.waitForTimeout(150);
   // The inserted text goes; editors that fold recent typing into the same undo step (Slate, CKEditor, TinyMCE) take
   // some of that too, exactly as they would for typed text. Nothing else changes.
   const undone=await tell(worker,page,{type:'debug.field'});if(process.env.GUMBO_DEBUG)console.log('UNDONE',JSON.stringify(undone?.text),JSON.stringify(undone?.before));expect(norm(undone.text)).not.toContain(norm(suggestion).slice(0,20));expect(norm(words).startsWith(norm(undone.text))).toBe(true);
  }
 });
}

test('never answers in passwords, card numbers, codes or a login form',async({page,worker,standin})=>{
 await page.goto(`${standin.url}/pages/plain.html`);
 for(const id of ['#pw','#card','#otp','#user']){
  await page.locator(id).click();await page.keyboard.type('1234');
  expect(await tell(worker,page,{type:'debug.field'}),id).toBeFalsy();
 }
 await page.locator('#search').click();await page.keyboard.type('flights to');
 const search=await tell(worker,page,{type:'debug.field'});expect(search.context.intent).toBe('search');
});
