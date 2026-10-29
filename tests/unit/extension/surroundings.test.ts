// @vitest-environment happy-dom
import {it,expect,describe,beforeEach,vi} from 'vitest';
// What the page is telling them (digest.ts) is read with case-insensitive attribute selectors happy-dom cannot parse.
vi.mock('../../../apps/extension/src/content/digest',()=>({saidNow:()=>[]}));
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {surroundingsOf} from '../../../apps/extension/src/content/surroundings';
import {readContext} from '../../../apps/extension/src/content/context';
import {stableContext,knownText,emptyRecall} from '../../../apps/extension/src/shared/prompts';

const load=(name:string)=>{document.body.innerHTML=readFileSync(resolve(import.meta.dirname,'pages',name),'utf8');};
const field=(el:HTMLElement,singleLine=true)=>({el,kind:el.isContentEditable?'editable' as const:'text' as const,editor:el.isContentEditable?'contenteditable' as const:el.tagName==='TEXTAREA'?'textarea' as const:'input' as const,singleLine});
const line=(lines:string[]|undefined,prefix:string)=>lines?.find(l=>l.startsWith(prefix));

describe('the text around the field',()=>{
 beforeEach(()=>{document.body.innerHTML='';});
 it('reads a table cell under its column header, with its row and the values above it',()=>{
  load('sheet.html');
  const around=surroundingsOf(document.getElementById('amount')!,{label:''})!;
  const table=line(around,'In a table:')!;
  expect(table).toContain('the cell under “Amount”');
  expect(table).toContain('Date: Oct 21 · Vendor: Acme Hosting');
  expect(table).toContain('above it in the column: $18.40 · $120.00 · $36.75');
  expect(table).toContain('the table “Receipts”');
  // Above the table, up to its heading: the instruction for the rows; never the other rows as loose text.
  expect(line(around,'Just above:')).toBe('Just above: Add each receipt as its own row. Amounts are in US dollars.');
  expect(line(around,'Under:')).toBe('Under: Finance › October expenses');
  expect(around.join('\n')).not.toMatch(/Home|Reports/);
 });
 it('reads the question above a form field, closest first, and the hint after it',()=>{
  load('form.html');
  const el=document.getElementById('why')!,context=readContext(field(el,false));
  const around=context.around!;
  expect(around[0]).toBe('Label: Your answer');
  const above=line(around,'Just above:')!;
  expect(above).toMatch(/Full name \/ Why do you want to join the robotics club\? \/ Tell us in two or three sentences\. Mention any past projects\.$/);
  expect(above).not.toContain('Robotics Club Application');
  expect(line(around,'Under:')).toBe('Under: Robotics Club Application');
  expect(line(around,'Just after:')).toMatch(/^Just after: 0 \/ 500/);
  expect(around.findIndex(l=>l.startsWith('Just above:'))).toBeLessThan(around.findIndex(l=>l.startsWith('Just after:')));
  // The prompt sends it closest first, and the facts guard may take facts from it.
  const prompt=stableContext(context,emptyRecall());
  expect(prompt).toContain('<around_the_field>\nLabel: Your answer\nJust above:');
  expect(prompt).not.toContain('on_the_page');
  expect(knownText(context,emptyRecall())).toContain('Mention any past projects');
 });
 it('reads the question a chat composer is under, and does not repeat a conversation already read as messages',()=>{
  load('chat.html');
  const el=document.getElementById('reply')!;
  const around=surroundingsOf(el,{label:'Message Tutor'})!;
  expect(line(around,'Just above:')).toContain('which branch of government can declare war');
  expect(line(around,'Just after:')).toContain('Tutor can make mistakes.');
  expect(around.join('\n')).not.toMatch(/Essay outline|Spanish practice/);
  const thread=[{author:'Tutor',text:'Before we start the quiz: which branch of government can declare war, and why did the framers give that power to it rather than to the president?'}];
  expect(line(surroundingsOf(el,{label:'Message Tutor',thread}),'Just above:')).toBeUndefined();
 });
 it('gives a search box only its label and heading',()=>{
  load('sheet.html');
  const search=document.createElement('input');search.type='search';search.setAttribute('aria-label','Search receipts');
  document.querySelector('section')!.insertBefore(search,document.querySelector('table'));
  const context=readContext(field(search));
  expect(context.intent).toBe('search');
  expect(context.around).toEqual(['Label: Search receipts','Under: Finance › October expenses']);
 });
 it('stays within about 1,500 characters',()=>{
  document.body.innerHTML=`<h1>Notes</h1>${'<p>'+'A long paragraph of notes about the trip. '.repeat(40)+'</p>'}<textarea id="t"></textarea><p>${'Another long paragraph after it. '.repeat(40)}</p>`;
  const around=surroundingsOf(document.getElementById('t')!,{label:'Notes'})!;
  expect(around.join('\n').length).toBeLessThanOrEqual(1500);
  expect(line(around,'Just above:')).toMatch(/^Just above: …/);
 });
});
