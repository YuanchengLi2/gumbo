import {test,expect,_electron as electron} from '@playwright/test';
import {mkdtempSync,writeFileSync,readFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {codeGateway,signIn} from '../fixtures/code-gateway';

const use=(id:string,name:string,input:unknown)=>({type:'tool_use',id,name,input});
const card=(broken:boolean)=>`import {AbsoluteFill,useCurrentFrame} from 'remotion';
import {FitText} from '@dream/engine';
export default function Card({title}:{title:string}){
 const frame=useCurrentFrame();
 ${broken?"if(frame>20)throw new Error('card-fails-late');":''}
 return <AbsoluteFill data-testid="card" style={{background:frame<15?'rgb(255, 0, 0)':'rgb(0, 0, 255)'}}><FitText style={{color:'#fff'}}>{title}</FitText></AbsoluteFill>;
}
`;

test('the agent writes an engine scene, the user sees its draft, the player runs it from dream-engine://, and a scene error reaches the next request',async()=>{
 test.setTimeout(300000);let sawError=false,turn=0;
 const script=(body:any,step:number)=>{
  // Each request starts a new conversation (step 0); the turn number picks the script.
  if(step===0)turn++;const all=JSON.stringify(body.messages??[]);
  if(turn===1)return[[use('w','write',{path:'src/card.tsx',content:card(false)})],[use('o','edit',{path:'project.json',oldText:'"outputs": []',newText:'"outputs": [{"id":"card","path":"src/card.tsx","kind":"scene","durationInFrames":60,"props":{"title":"Hello"}}]'})],[use('s','edit',{path:'project.json',oldText:'"spine": [],',newText:'"spine": [{"id":"c1","assetId":"output:card","srcIn":0,"srcOut":2,"speed":1,"audio":{"mute":true},"reason":"Card"}],'})],[{type:'text',text:'The intro card is in the preview.'}]][step]??[];
  if(turn===2)return[[use('w2','write',{path:'src/card.tsx',content:card(true)})],[{type:'text',text:'Updated the card.'}]][step]??[];
  // The agent is told of the error with its next message, with the file and line.
  sawError||=all.includes('reported errors while playing')&&all.includes('card-fails-late')&&/src\/card\.tsx:5/.test(all);
  return[[{type:'text',text:sawError?'The card fails after frame 20.':'No scene errors.'}]][step]??[];
 };
 const gateway=await codeGateway({script}),profile=mkdtempSync(join(tmpdir(),'dream-engine-profile-')),folder=mkdtempSync(join(tmpdir(),'dream-engine-agent-'));
 writeFileSync(join(profile,'cloud.json'),JSON.stringify({url:gateway.url,anonKey:'local-fixture'}));
 const app=await electron.launch({executablePath:resolve(process.env.DREAM_PACKAGE_EXECUTABLE??'apps/desktop/out/Dream-win32-x64/Dream.exe'),args:[`--user-data-dir=${profile}`],env:{...process.env,DREAM_HEADLESS:'1'}});
 try{
  const page=await app.firstWindow(),errors:string[]=[];await signIn(page);page.on('pageerror',e=>errors.push(e.message));
  await app.evaluate(({dialog},folder)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]});},folder);await page.evaluate(()=>window.dream.pickProject(true));
  await page.evaluate(async folder=>{await window.dream.command({type:'create',folder,name:'Engine agent'});},folder);await page.reload();
  const run=async(text:string)=>{await page.evaluate(text=>window.dream.command({type:'message',text}),text);await expect.poll(async()=>(await page.evaluate(()=>window.dream.command({type:'state'}))).aiStatus,{timeout:120000}).toBe('complete');};
  await run('Make an intro card');
  const state:any=await page.evaluate(()=>window.dream.command({type:'state'}));
  const scene:any=state.footage.assets.find((a:any)=>a.scene?.format==='engine');expect(scene?.scene.engine.chunks).toEqual(['core']);
  expect(state.experience.activity.events.some((e:any)=>e.tool==='write'&&e.drafts?.length===1)).toBe(true);
  expect(readFileSync(join(folder,'Workspace/src/card.tsx'),'utf8')).toContain('FitText');
  // The player runs the published scene from dream-engine:// and seeking draws the frame for the new position.
  const player=page.locator(`.preview-viewport iframe[src^="dream-engine://app/scene/${scene.id}/"]`);await expect(player).toHaveCount(1,{timeout:30000});
  const frame=page.frameLocator(`.preview-viewport iframe[src^="dream-engine://app/scene/${scene.id}/"]`).locator('[data-testid=card]');
  // The chat shows the same published scene as a live preview.
  await expect(page.locator(`.scene-peek iframe[src^="dream-engine://app/scene/${scene.id}/"]`)).toHaveCount(1);
  await page.getByLabel('Preview position').fill('5');await expect(frame).toHaveCSS('background-color','rgb(255, 0, 0)');
  await page.getByLabel('Preview position').fill('30');await expect(frame).toHaveCSS('background-color','rgb(0, 0, 255)');
  await expect(frame).toContainText('Hello');
  // A scene that fails while playing shows the error over the player and the agent sees it, with the file and line, next time.
  await run('Make it fail late');
  const broken:any=((await page.evaluate(()=>window.dream.command({type:'state'}))) as any).footage.assets.filter((a:any)=>a.scene?.format==='engine').at(-1);
  await expect(page.locator(`.preview-viewport iframe[src^="dream-engine://app/scene/${broken.id}/"]`)).toHaveCount(1,{timeout:30000});
  await page.getByLabel('Preview position').fill('40');await expect(page.getByRole('alert').filter({hasText:'card-fails-late'})).toBeVisible({timeout:30000});
  await run('Check the preview');expect(sawError).toBe(true);
  expect(errors).toEqual([]);
 }finally{await app.close();await gateway.close?.();}
});
