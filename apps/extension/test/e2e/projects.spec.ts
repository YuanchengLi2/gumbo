import {test,expect} from '../fixtures';
/** Projects: visits along one chain of work land in one project, and its rolling note is written by the model (here the
 * stand-in's scripted reply) once enough happened. */
test('a chain of visits becomes a project with a note',async({signedIn,page,standin})=>{
 standin.script=body=>/one thread of a person's work/.test(String(body.system))?{text:JSON.stringify({name:'Biology course',goal:'Keep up with Biology 101.',leftOff:'Looking at the assignments.',open:['Homework 3'],decisions:[]})}:{text:''};
 // Quick to promote and to note, for the test.
 await signedIn.evaluate(()=>chrome.storage.local.set({memoryConfig:{projects:{promoteMs:0,promoteVisits:2,noteVisits:2,noteGapMs:0}}}));
 await page.goto(`${standin.url}/pages/lms/courses.html`);
 await page.click('text=Biology 101');await page.waitForURL(/course\.html/);
 await page.click('text=Assignments');await page.waitForURL(/assignments\.html/);
 await page.click('text=Dashboard').catch(()=>page.goto(`${standin.url}/pages/lms/courses.html`));
 const projects=()=>signedIn.evaluate(async()=>{const g=(globalThis as any).gumbo;await g.memory.flush();return g.memory.projects();});
 await expect.poll(async()=>(await projects()).find((p:any)=>p.note)?.name,{timeout:90_000,intervals:[1000]}).toBe('Biology course');
 const p=(await projects()).find((x:any)=>x.note);
 expect(p.note.open).toEqual(['Homework 3']);
 // The visits of the chain carry it.
 const visits:any[]=await signedIn.evaluate(()=>(globalThis as any).gumbo.db.recent('visits',20));
 expect(visits.filter(v=>v.project===p.id).length).toBeGreaterThanOrEqual(2);
 // The note was asked with the pages they went through.
 const asked=standin.bodies.find(b=>/one thread of a person's work/.test(String(b.system)));
 expect(JSON.stringify(asked.messages)).toContain('Biology 101');
});
