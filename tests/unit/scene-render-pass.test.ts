import {describe,it,expect} from 'vitest';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {sceneRenderPass,sceneRenderToken,MAX_FRAMES} from '../../supabase/functions/dream-gateway/scene-render';

/** Quick render's passes: who the gateway gives one to (scene-render.ts), and that the render service on Modal
 * (services/scene-render/passes.py) takes the gateway's and refuses a forged, expired or too-short one. */
const env=(values:Record<string,string>)=>(name:string)=>values[name];
const ready={DREAM_SCENE_RENDER_URL:'https://gumbo--gumbo-scene-render-web.modal.run',DREAM_SCENE_RENDER_SECRET:'shared-secret'};
const user={id:'11111111-1111-4111-8111-111111111111'};
/** passes.check_pass in Python: the account id, or the error it raises. */
function checkInPython(token:string,secret:string,frames:number){
 const script='import sys,passes\ntry:\n print(passes.check_pass(sys.argv[1],sys.argv[2],int(sys.argv[3])))\nexcept PermissionError as e:\n print("refused:",e)';
 return execFileSync('python',['-c',script,token,secret,String(frames)],{cwd:resolve('services/scene-render'),encoding:'utf8'}).trim();
}
let python=true;try{execFileSync('python',['--version']);}catch{python=false;}

describe('quick render passes',()=>{
 it('go to Pro, Max and the owner once it is set up, and to the plans the gateway names',async()=>{
  expect((await sceneRenderPass(user,{plan:'pro'},env({}))).body).toEqual({available:false,reason:'Quick render is not set up yet.'});
  expect((await sceneRenderPass(user,{plan:'free'},env(ready))).body).toEqual({available:false,reason:'Quick render comes with Pro and Max.'});
  for(const account of [{plan:'pro'},{plan:'max20'},{plan:'free',is_admin:true}])expect((await sceneRenderPass(user,account,env(ready))).body).toMatchObject({available:true,url:ready.DREAM_SCENE_RENDER_URL,token:expect.stringMatching(/^[\w-]+\.[\w-]+$/)});
  expect((await sceneRenderPass(user,{plan:'free'},env({...ready,DREAM_SCENE_RENDER_PLANS:'free,pro'}))).body).toMatchObject({available:true});
 });
 it.skipIf(!python)('is taken by the render service, and a forged, expired or too-short one is refused',async()=>{
  const {token}=(await sceneRenderPass(user,{plan:'pro'},env(ready))).body as {token:string};
  expect(checkInPython(token,'shared-secret',600)).toBe(user.id);
  expect(checkInPython(token,'another-secret',600)).toMatch(/^refused: This quick render pass is not valid/);
  expect(checkInPython(token.slice(0,-2)+'xx','shared-secret',600)).toMatch(/^refused: This quick render pass is not valid/);
  expect(checkInPython(token,'shared-secret',MAX_FRAMES+1)).toMatch(/^refused: This scene is longer/);
  const old=await sceneRenderToken('shared-secret',{sub:user.id,exp:Math.floor(Date.now()/1000)-5,frames:MAX_FRAMES});
  expect(checkInPython(old,'shared-secret',600)).toMatch(/^refused: This quick render pass ran out/);
 });
});
