// @vitest-environment happy-dom
import {it,expect,describe} from 'vitest';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {readPage,blocksOf,changed} from '../../../apps/extension/src/content/facts';
import {factText,factsOfLines,type Fact} from '../../../apps/extension/src/shared/facts';

// Saved pages read the way the content script reads them: their text without menus, and the facts on them.
const read=(name:string,except?:(d:Document)=>Element|null)=>{
 document.documentElement.innerHTML=readFileSync(resolve(import.meta.dirname,'pages',name),'utf8').replace(/^<!doctype html>\s*/i,'').replace(/^<html>|<\/html>\s*$/g,'');
 const root=document.querySelector('main,article,[role=main]')??document.body;
 return readPage(root,{except:except?.(document)});
};
const has=(facts:Fact[],key:RegExp,value:string)=>facts.some(f=>key.test(f.key)&&f.value===value);
const show=(facts:Fact[])=>facts.map(factText).join('\n');

describe('facts on a page',()=>{
 it('an invoice: the total at the bottom, its number, dates, items and who to ask',()=>{
  const page=read('invoice.html'),f=page.facts;
  expect(has(f,/^total due$/i,'$482.00'),show(f)).toBe(true);
  expect(has(f,/^subtotal$/i,'$482.00'),show(f)).toBe(true);
  expect(has(f,/^invoice number$/i,'INV-4471'),show(f)).toBe(true);
  expect(has(f,/^due date$/i,'November 1, 2026'),show(f)).toBe(true);
  expect(has(f,/^issued$/i,'October 2, 2026'),show(f)).toBe(true);
  expect(has(f,/^amount$/i,'$122.00'),show(f)).toBe(true);
  expect(f.find(f=>f.value==='$122.00')!.near).toContain('Logo revisions');
  expect(has(f,/email/i,'billing@northwind.example'),show(f)).toBe(true);
  expect(f.some(f=>f.value==='(503) 555-0142'),show(f)).toBe(true);
  expect(f.some(f=>/88 Harbor Street/.test(f.value)),show(f)).toBe(true);
  expect(has(f,/^pay this invoice$/i,'https://pay.northwind.example/i/INV-4471'),show(f)).toBe(true);
  // A card number is never kept, nor the menus and the footer.
  expect(show(f)).not.toMatch(/4242/);
  expect(show(f)).not.toMatch(/Dashboard|Privacy|dana@acme/);
  expect(page.text).toContain('Total due');expect(page.text).not.toMatch(/Dashboard|Privacy|Signed in as/);
 });
 it('a booking: each flight under its columns, the code, and the fare paid',()=>{
  const f=read('booking.html').facts;
  expect(has(f,/^confirmation code$/i,'K7XQ2M'),show(f)).toBe(true);
  expect(has(f,/^flight$/i,'UA 1182'),show(f)).toBe(true);
  expect(has(f,/^flight$/i,'UA 2207'),show(f)).toBe(true);
  const departs=f.find(f=>f.key==='Departs'&&f.value==='Nov 8, 6:15 PM');
  expect(departs?.near,show(f)).toMatch(/Return.*UA 2207/);
  expect(has(f,/^total paid$/i,'$412.60'),show(f)).toBe(true);
  expect(has(f,/^fare$/i,'Economy (K)'),show(f)).toBe(true);
  // Never a password, the text in a field, or the footer's menu.
  expect(show(f)).not.toMatch(/hunter22|99812|800 555/);
 });
 it('an order: its order and tracking numbers, the delivery date, where it ships and the total',()=>{
  const f=read('order.html').facts;
  expect(has(f,/^order number$/i,'112-4459812-3301'),show(f)).toBe(true);
  expect(has(f,/^tracking number$/i,'1Z999AA10123456784'),show(f)).toBe(true);
  expect(f.some(f=>f.value==='Friday, October 30'),show(f)).toBe(true);
  expect(has(f,/^carrier$/i,'UPS Ground'),show(f)).toBe(true);
  expect(has(f,/^order total$/i,'$64.18'),show(f)).toBe(true);
  expect(f.some(f=>/221 Baker Street/.test(f.value)),show(f)).toBe(true);
  expect(f.some(f=>f.value.startsWith('https://www.ups.com/track')),show(f)).toBe(true);
  // A sign-in link and a one-time code are not kept.
  expect(show(f)).not.toMatch(/token=|482913/);
 });
 it('never reads the field being written in',()=>{
  const f=read('order.html',d=>d.querySelectorAll('.card')[2]).facts;
  expect(f.some(f=>f.value==='$64.18')).toBe(false);
  expect(f.some(f=>f.value==='112-4459812-3301')).toBe(true);
 });
 it('is read again when its content changes, not its length',()=>{
  const lines=(...t:string[])=>t.map(text=>({text}));
  const inbox=blocksOf(lines('Re: Q4 budget — 5 min ago','Lunch on Friday? — 12 min ago','Your invoice from Northwind — 1 h ago'));
  // A clock ticking is no change; another email opened, the same length as the one before, is.
  expect(changed(inbox,blocksOf(lines('Re: Q4 budget — 6 min ago','Lunch on Friday? — 13 min ago','Your invoice from Northwind — 1 h ago')))).toBe(false);
  expect(changed(blocksOf(lines('From: Sam','Can we move the call to 3?')),blocksOf(lines('From: Ana','Invoice attached, total $482.')))).toBe(true);
 });
 it('reads labels and typed values in plain lines',()=>{
  const f=factsOfLines([{text:'Meeting moved',heading:true},{text:'New time: Thursday, Nov 5 at 2:30 pm'},{text:'Room'},{text:'4B-201'},{text:'Reply to priya@acme.example by Friday.'}]);
  expect(has(f,/^new time$/i,'Thursday, Nov 5 at 2:30 pm')).toBe(true);
  expect(has(f,/^room$/i,'4B-201')).toBe(true);
  // The words before a value name it; with none, its kind does.
  expect(f.find(f=>f.value==='priya@acme.example')?.key).toBe('Reply to');
  expect(factsOfLines([{text:'Write any time: dana@acme.example'},{text:'(415) 555-0100'}]).map(f=>f.key)).toEqual(['Write any time','Phone']);
 });
});
