import {test,expect} from '../fixtures';

/** What the user already has comes in: another assistant's memory (kept as notes, its facts picked out without
 * overwriting the user's own), and the Gumbo profile. */
test('brings in pasted memory and the profile, never overwriting what the user set',async({signedIn,standin})=>{
 standin.script=b=>/remembers about a person/.test(String(b.system))?{json:{id:'m',type:'message',role:'assistant',content:[{type:'text',text:'{"name":"Dana P.","signOff":"Cheers, Dana","email":"dana@example.com","other":"Product designer at Northwind"}'}],stop_reason:'end_turn',usage:{input_tokens:10,output_tokens:20}}}:{text:''};
 await signedIn.evaluate(async()=>{const {settings}=await chrome.storage.local.get('settings');await chrome.storage.local.set({settings:{...(settings as any),facts:{email:'me@own.com'}}});});
 const pasted='- Dana is a product designer at Northwind.\n- Prefers short, friendly emails and signs off with "Cheers, Dana".\n- Working on the onboarding redesign shipping November 3.';
 const result=await signedIn.evaluate(text=>(globalThis as any).gumbo.importAssistantMemory(text),pasted);
 expect(result.notes).toBe(3);expect(result.facts).toMatchObject({name:'Dana P.',signOff:'Cheers, Dana',email:'me@own.com'});
 // The notes are memory: search finds them.
 await expect.poll(async()=>(await signedIn.evaluate(()=>(globalThis as any).gumbo.search('when does the onboarding redesign ship',{k:3}))).some((f:any)=>/November 3/.test(f.text)),{timeout:30_000}).toBe(true);
});
