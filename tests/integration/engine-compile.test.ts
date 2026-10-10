import {it,expect} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {compileScene,mapStack} from '../../apps/project-service/src/engine-compile';

function workspace(files:Record<string,string>){
 const root=mkdtempSync(join(tmpdir(),'dream-compile-'));
 for(const [path,text] of Object.entries(files)){mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),text);}
 return root;
}
const scene=`import {useCurrentFrame} from 'remotion';\nimport {scaleLinear} from 'd3';\nimport * as THREE from 'three';\nimport {FitText} from '@dream/engine';\nexport default function Scene(){const f=useCurrentFrame();return <FitText>{String(scaleLinear()(f))+THREE.REVISION}</FitText>;}\n`;

it('resolves engine modules to the shared runtime and loads only the chunks the scene needs',async()=>{
 const result=await compileScene(workspace({'src/scene.tsx':scene}),{entry:'src/scene.tsx'});
 expect(result.errors).toEqual([]);expect(result.chunks).toEqual(['core','three','d3']);
 for(const name of ['remotion','d3','three','@dream/engine','react/jsx-runtime'])expect(result.bundle).toContain(`DreamEngine.require("${name}")`);
 expect(result.bundle).toContain('DreamEngine.define("scene"');expect(result.bundle.length).toBeLessThan(20_000);
 const helpers=await compileScene(workspace({'src/s.tsx':"import {Scene3D} from '@dream/engine';export default()=> <Scene3D/>;"}),{entry:'src/s.tsx'});expect(helpers.chunks).toEqual(['core','three']);
});

it('bundles installed packages, keeps their React on the shared runtime, and explains missing packages',async()=>{
 const root=workspace({
  'src/scene.tsx':"import pad from 'tiny-pad';import Badge from 'react-badge';export default()=> <Badge>{pad('x')}</Badge>;",
  'node_modules/tiny-pad/package.json':'{"name":"tiny-pad","main":"index.js"}','node_modules/tiny-pad/index.js':"module.exports=s=>'[['+s+']]-tiny-pad-marker';",
  'node_modules/react-badge/package.json':'{"name":"react-badge","main":"index.js"}','node_modules/react-badge/index.js':"const React=require('react');module.exports=p=>React.createElement('b',null,p.children);",
 });
 const result=await compileScene(root,{entry:'src/scene.tsx'});expect(result.errors).toEqual([]);
 expect(result.bundle).toContain('tiny-pad-marker');expect(result.bundle).toContain('DreamEngine.require("react")');expect(result.bundle).not.toContain('react.production');
 const missing=await compileScene(workspace({'src/scene.tsx':"import confetti from 'canvas-confetti';export default()=>{confetti();return null;};"}),{entry:'src/scene.tsx'});
 expect(missing.errors[0]).toMatchObject({file:'src/scene.tsx',line:1});expect(missing.errors[0].text).toContain('npm install canvas-confetti');
});

it('keeps scenes inside src, resources and installed packages, and turns file imports into resource URLs',async()=>{
 const root=workspace({'src/scene.tsx':"import logo from './logo.png';import {resource} from '@dream/engine';export default()=> <img src={logo} data-bg={resource('textures/paper.jpg')}/>;",'src/logo.png':'png-bytes','resources/textures/paper.jpg':'jpg-bytes','secret.ts':'export const key=1;'});
 const result=await compileScene(root,{entry:'src/scene.tsx'});expect(result.errors).toEqual([]);
 expect(result.resources).toEqual({'textures/paper.jpg':'resources/textures/paper.jpg','@src/logo.png':'src/logo.png'});expect(result.bundle).toContain('"files/%40src/logo.png"');
 const escape=await compileScene(root.replace(/$/,''),{entry:'src/scene.tsx'}).then(()=>compileScene(workspace({'src/scene.tsx':"import {key} from '../secret';export default()=>key;",'secret.ts':'export const key=1;'}),{entry:'src/scene.tsx'}));
 expect(escape.errors[0].text).toContain('src/, resources/ and installed packages');
});

it('hashes stably, changes when any input changes, and reports errors with file positions',async()=>{
 const root=workspace({'src/scene.tsx':"import {label} from './label';export default()=> <div>{label}</div>;",'src/label.ts':"export const label='one';"});
 const a=await compileScene(root,{entry:'src/scene.tsx'}),b=await compileScene(root,{entry:'src/scene.tsx'});expect(a.hash).toBe(b.hash);expect(a.inputs).toEqual(expect.arrayContaining(['src/scene.tsx','src/label.ts']));
 writeFileSync(join(root,'src/label.ts'),"export const label='two';");const c=await compileScene(root,{entry:'src/scene.tsx'});expect(c.hash).not.toBe(a.hash);
 writeFileSync(join(root,'src/label.ts'),"export const label='three'\nexport const broken = ;");const d=await compileScene(root,{entry:'src/scene.tsx'});
 expect(d.errors[0]).toMatchObject({file:'src/label.ts',line:2});expect(d.bundle).toBe('');
});

it('maps a runtime stack in the bundle back to the authored line',async()=>{
 const root=workspace({'src/scene.tsx':"import {useCurrentFrame} from 'remotion';\nexport default function Scene(){\n const f=useCurrentFrame();\n if(f>3)throw new Error('boom-marker');\n return null;\n}\n"});
 const result=await compileScene(root,{entry:'src/scene.tsx'}),lines=result.bundle.split('\n'),line=lines.findIndex(l=>l.includes('boom-marker'))+1,column=lines[line-1].indexOf('throw')+1;
 expect(await mapStack(`Error: boom-marker\n    at Scene (dream-engine://app/scene/code_x/bundle.js:${line}:${column})`,result.map)).toMatch(/^src\/scene\.tsx:4:/);
});
