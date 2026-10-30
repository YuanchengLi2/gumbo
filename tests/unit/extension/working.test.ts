import {describe,expect,it,vi} from 'vitest';
vi.mock('../../../apps/extension/src/background/db',()=>({recent:async()=>[]}));
const {holdFacts,factsFor,factsBlock}=await import('../../../apps/extension/src/background/memory/working');

describe('the working set: facts of what was seen lately, ranked for the moment as it is typed',()=>{
 const booking='https://united.example/trip',invoice='https://acme.example/inv-1043',plan='https://notes.example/offsite';
 holdFacts(booking,'Your trip confirmation - United Airlines',[{key:'Departs',value:'San Francisco (SFO) 4:55 PM, Terminal 3'},{key:'Arrives',value:'Portland (PDX) 6:45 PM'},{key:'Confirmation number',value:'KX7Q2M'},{key:'Seat',value:'21C'}],Date.now()-120_000);
 holdFacts(invoice,'Invoice INV-1043 from Acme Supply Co.',[{key:'Invoice number',value:'INV-1043'},{key:'Subtotal',value:'$461.00'},{key:'Total due',value:'$482.00'},{key:'Due date',value:'November 20, 2026'}],Date.now()-60_000);
 holdFacts(plan,'Team offsite - plan',[{key:'Venue',value:'Lakeview Lodge, 410 Lakeview Drive, Lake Oswego'}],Date.now()-30_000);
 const top=(text:string,url='https://mail.example/compose')=>factsFor({text,url}).map(f=>`${f.key}: ${f.value}`);
 it('brings the fact the sentence just reached for, by its words and the kind of value it asks for, with its label',()=>{
  // Both times of the booking come first, each with what it is: which one "lands at" means is the model's to read.
  expect(top('Hi Ana,\nMy flight lands at\nWhat time does your flight land on Tuesday?').slice(0,2)).toEqual(expect.arrayContaining(['Arrives: Portland (PDX) 6:45 PM','Departs: San Francisco (SFO) 4:55 PM, Terminal 3']));
  expect(top('yes, it came in. it\'s\ndid the acme invoice come in? how much was it?').slice(0,3)).toContain('Total due: $482.00');
  expect(top('it\'s at\nwhat\'s the address for the offsite?')[0]).toBe('Venue: Lakeview Lodge, 410 Lakeview Drive, Lake Oswego');
 });
 it('with little to go on (another language), what was seen in the last quarter hour comes, for the model to judge',()=>{
  expect(top('Mi vuelo llega a las\n¡Hola Dana! ¿A qué hora llega tu vuelo el martes?').length).toBeGreaterThan(0);
 });
 it('leaves out the page in front (its facts are on the screen already) and writes the block the prompt carries',()=>{
  expect(factsFor({text:'how much is the total',url:invoice}).some(f=>f.url===invoice)).toBe(false);
  expect(factsBlock(factsFor({text:'how much',url:booking}))).toMatch(/^<facts_from_what_they_saw>\n(- .*\n)*- Total due: \$482\.00 \(Invoice INV-1043 from Acme Supply Co\., 1 min ago\)\n/);
 });
});
