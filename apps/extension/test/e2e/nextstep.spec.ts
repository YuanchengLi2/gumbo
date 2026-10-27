import {test,expect,tell} from '../fixtures';
import type {Page,Worker} from '@playwright/test';
/** After the user finishes entering something, Tab offers the step that goes on with it, wherever it is on the page (here
 * a Submit in a bar at the bottom of the window, outside the question), without a long pause, anchored to it; a final
 * step takes a second press. Never mid-word, and a text suggestion showing comes first. No selector is known to the
 * extension: the stand-in model picks the element by the name it was sent. */
const tab=(worker:Worker,page:Page)=>tell(worker,page,{type:'debug.predict'});
const isPredict=(b:any)=>/You are Gumbo's Tab/.test(JSON.stringify(b.system));
const sent=(b:any)=>b.messages[0].content.map((c:any)=>c.text).join('\n')+'\n'+b.messages[0].content.slice(1).map((c:any)=>c.text??'').join('\n');
const idIn=(text:string,name:string)=>new RegExp(`(e\\d+) \\w+ "${name}"`).exec(text)?.[1];
const submitWhenAnswered=(b:any)=>{
 if(!isPredict(b))return{text:''};
 const text=sent(b),id=idIn(text,'Submit answer');
 // The stand-in offers Submit only once an answer is in the form, as the model would.
 return id&&/Your answer [^\n]*= “\d+”/.test(text)?{text:JSON.stringify({confidence:0.9,label:'Submit your answer',steps:[{do:'click',id}],likely:[{id,p:0.8,label:'Submit'}]})}:{text:JSON.stringify({confidence:0,steps:[],likely:[]})};
};

test('after an answer is typed, Submit (outside the question) is offered at once, by the button, and takes two presses',async({page,signedIn,standin})=>{
 void signedIn;standin.script=submitWhenAnswered;
 await page.goto(`${standin.url}/pages/quiz.html`);await page.locator('#answer').click();
 // Typing: never a move mid-word.
 for(const key of ['5','6']){await page.keyboard.type(key);await page.waitForTimeout(90);expect((await tab(signedIn,page))?.showing).toBeFalsy();}
 const stopped=Date.now();
 await expect.poll(async()=>(await tab(signedIn,page))?.label,{timeout:4000,intervals:[50]}).toBe('Submit your answer');
 const ms=Date.now()-stopped;console.log(`next step shown ${ms} ms after the last keystroke`);
 expect(ms).toBeLessThan(2000);
 // It was asked with the whole page: the bar's button, and what the page said.
 const body=standin.bodies.filter(isPredict).at(-1);
 expect(sent(body)).toContain('Submit answer');expect(sent(body)).toContain('<the_whole_page>');
 // Anchored to the button, not the cursor.
 const state=await tab(signedIn,page),button=await page.locator('#submit').boundingBox();
 const [x,y,w,h]=state.chipRect;expect(Math.abs((y+h/2)-(button!.y+button!.height/2))<60||Math.abs(x-(button!.x+button!.width))<80||y<button!.y).toBe(true);
 // A final step: the first press arms it, the second does it.
 await page.keyboard.press('Alt+q');
 await expect.poll(async()=>(await tab(signedIn,page))?.waiting,{timeout:3000}).toBe(true);
 await expect(page.locator('#submitted')).toBeHidden();
 await page.keyboard.press('Alt+q');
 await expect(page.locator('#status')).toHaveText('Correct! On to question 2.');
});

test('Alt and + goes to the next likely move, outlined in its place',async({page,signedIn,standin})=>{
 void signedIn;
 standin.script=b=>{
  if(!isPredict(b))return{text:''};
  const text=sent(b),submit=idIn(text,'Submit answer'),skip=idIn(text,'Skip question');
  return submit&&skip&&/Your answer [^\n]*= “\d+”/.test(text)?{text:JSON.stringify({confidence:0.9,label:'Submit your answer',steps:[{do:'click',id:submit}],likely:[{id:submit,p:0.7,label:'Submit your answer'},{id:skip,p:0.2,label:'Skip this question'}]})}:{text:JSON.stringify({confidence:0,steps:[],likely:[]})};
 };
 await page.goto(`${standin.url}/pages/quiz.html`);await page.locator('#answer').click();await page.keyboard.type('56');
 await expect.poll(async()=>(await tab(signedIn,page))?.label,{timeout:4000}).toBe('Submit your answer');
 await page.keyboard.press('Alt+Equal');
 expect((await tab(signedIn,page)).label).toBe('Skip this question (2/2)');
 await page.keyboard.press('Alt+Equal');
 expect((await tab(signedIn,page)).label).toBe('Submit your answer (1/2)');
 await expect(page.locator('#answer')).toHaveValue('56');
});

test('clicking quickly from page to page, each page is still asked about, at once',async({page,signedIn,standin})=>{
 void signedIn;
 const asked:{title:string;at:number}[]=[];
 standin.script=b=>{if(isPredict(b)){const title=/<page url="[^"]*" title="([^"]*)"/.exec(sent(b))?.[1]??'';asked.push({title,at:Date.now()});}return{text:JSON.stringify({confidence:0,steps:[],likely:[]})};};
 const arrived:{title:string;at:number}[]=[];
 for(const [path,link] of [['/pages/lms/courses.html','text=Biology 101'],['','text=Assignments']] as const){
  if(path)await page.goto(`${standin.url}${path}`);
  await page.mouse.move(300,300);await page.waitForTimeout(700);
  arrived.push({title:await page.title(),at:Date.now()});
  await page.click(link);await page.waitForLoadState('domcontentloaded');
 }
 arrived.push({title:await page.title(),at:Date.now()});await page.mouse.move(320,320);
 await expect.poll(()=>asked.filter(a=>/Assignments/.test(a.title)).length,{timeout:4000}).toBeGreaterThan(0);
 for(const a of arrived){const first=asked.find(x=>x.title===a.title);expect(first,`asked about “${a.title}”`).toBeTruthy();}
});

test('a text suggestion showing comes before a move',async({page,signedIn,standin})=>{
 void signedIn;
 standin.script=b=>b.purpose==='tab'?{text:' is the answer.'}:submitWhenAnswered(b);
 await page.goto(`${standin.url}/pages/quiz.html`);await page.locator('#answer').click();
 await page.keyboard.type('56');
 await expect.poll(async()=>(await tell(signedIn,page,{type:'debug.tab'}))?.showing,{timeout:4000}).toBe(true);
 await page.waitForTimeout(600);
 expect((await tab(signedIn,page))?.showing).toBeFalsy();
 // The text suggestion dismissed, the move shows.
 await page.keyboard.press('Escape');
 await page.locator('#answer').press('End');
 await expect.poll(async()=>(await tab(signedIn,page))?.label,{timeout:4000}).toBe('Submit your answer');
});
