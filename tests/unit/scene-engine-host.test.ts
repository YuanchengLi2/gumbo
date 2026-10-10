import {it,expect} from 'vitest';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {AssetSchema} from '@dream/footage';
import {engineHostHtml,engineCsp,chunksFor,MODULES,CHUNKS,moduleName,unknownModuleMessage,sceneFrameIndex} from '@dream/scene-engine';
import {engineRoute,sceneFromAsset,DraftScenes} from '../../apps/desktop/src/main/engine-routes';

const config={assetId:'scene_1',revisionId:'a'.repeat(64),width:1280,height:720,fps:30,durationInFrames:90,chunks:['core','three']};

it('builds a host page per environment that loads only the runtime chunks it needs from its own origin',()=>{
 const player=engineHostHtml(config,{runtimeBase:'../../runtime/1',sceneBase:'.',cspSources:['dream-engine:']}),exporter=engineHostHtml(config,{runtimeBase:'../../runtime/1',sceneBase:'.',cspSources:['http://127.0.0.1:5123']});
 expect(player.csp).toContain("default-src 'none'");expect(player.csp).toContain('script-src dream-engine:');expect(player.csp).not.toContain('http');expect(player.csp).toContain('worker-src blob:');
 expect(exporter.csp).toContain('script-src http://127.0.0.1:5123');expect(exporter.csp).not.toContain('dream-engine:');
 const scripts=[...player.html.matchAll(/<script src="([^"]+)"/g)].map(m=>m[1]);expect(scripts).toEqual(['../../runtime/1/core.js','../../runtime/1/three.js','./bundle.js']);
 expect(player.html).toContain('<link rel="stylesheet" href="../../runtime/1/fonts.css">');
});

it('escapes scene configuration so props cannot break out of the page',()=>{
 const {html}=engineHostHtml({...config,props:{title:'</script><script>alert(1)</script>&'}},{runtimeBase:'../../runtime/1',sceneBase:'.',cspSources:['dream-engine:']});
 expect(html).not.toContain('</script><script>alert');expect(html).toContain('\\u003c/script\\u003e');
 const json=html.match(/<script type="application\/json" id="dream-scene-config">(.*?)<\/script>/)![1];expect(JSON.parse(json).props.title).toBe('</script><script>alert(1)</script>&');
 expect(engineCsp(['dream-engine:'])).not.toContain('unsafe-eval');
});

it('maps every import to one chunk, normalizes spellings and loads the 3D chunk for engine 3D helpers',()=>{
 expect(chunksFor(['react','remotion','d3-scale'])).toEqual(['core','d3']);expect(chunksFor(['dream-module:three'])).toEqual(['core','three']);expect(chunksFor(['@dream/engine'],true)).toEqual(['core','three']);
 expect(moduleName('three/examples/jsm/geometries/RoundedBoxGeometry')).toBe('three/addons/geometries/RoundedBoxGeometry.js');expect(moduleName('react/jsx-dev-runtime')).toBe('react/jsx-runtime');
 for(const chunk of Object.values(MODULES))expect(CHUNKS).toContain(chunk);
 // Every listed module is registered by its chunk entry, so the compiler never promises something the runtime lacks.
 const sources=Object.fromEntries(CHUNKS.map(chunk=>[chunk,readFileSync(resolve(`packages/scene-engine/src/runtime/chunks/${chunk}.ts`),'utf8')]));
 for(const [listedName,chunk] of Object.entries(MODULES)){const name=moduleName(listedName),source=sources[chunk];const listed=source.includes(`'${name}'`)||name.startsWith('three/addons/')&&source.includes(`'${name.slice('three/addons/'.length)}'`)||chunk==='d3'&&source.includes("chunk==='d3'");expect(listed,`${name} in ${chunk}`).toBe(true);}
 expect(unknownModuleMessage('@scope/pkg/sub')).toContain('npm install @scope/pkg');
});

it('uses the same frame formula as live scenes',()=>{
 expect(sceneFrameIndex({frame:45,fps:30,sourceIn:1,speed:2,sceneFps:30,durationInFrames:300})).toBe(120);
 expect(sceneFrameIndex({frame:-5,fps:30,sceneFps:24,durationInFrames:10})).toBe(0);expect(sceneFrameIndex({frame:900,fps:30,sceneFps:30,durationInFrames:10})).toBe(9);
});

it('serves registered scenes, resources by content hash and project media, and nothing else',()=>{
 const root=mkdtempSync(join(tmpdir(),'dream-engine-routes-')),generated=join(root,'Media/Generated/abc'),store=join(root,'Media/Engine/files'),runtime=join(root,'runtime');
 mkdirSync(generated,{recursive:true});mkdirSync(store,{recursive:true});mkdirSync(join(runtime,'1'),{recursive:true});
 const hash='b'.repeat(64);writeFileSync(join(store,hash),'png');writeFileSync(join(generated,'scene.js'),'bundle');writeFileSync(join(generated,'resources.json'),JSON.stringify({files:{'logos/brand.png':hash}}));writeFileSync(join(runtime,'1','core.js'),'core');writeFileSync(join(root,'clip.mp4'),'video');
 const scene=AssetSchema.parse({id:'scene_1',filename:'Intro',kind:'video',durationSec:3,originalPath:join(generated,'scene.js'),fingerprint:'x',scene:{format:'engine',revisionId:'a'.repeat(64),durationInFrames:90,engine:{version:1,chunks:['core']}}});
 const clip=AssetSchema.parse({id:'clip',filename:'clip.mp4',kind:'video',durationSec:3,originalPath:join(root,'clip.mp4'),fingerprint:'y'});
 const assets=new Map([[scene.id,scene],[clip.id,clip]]),drafts=new DraftScenes(1);
 const route=(path:string)=>engineRoute(path,{runtimeDir:runtime,asset:id=>assets.get(id),scene:id=>{const a=assets.get(id);return a?sceneFromAsset(a):undefined;},draft:hash=>drafts.get(hash),cspSources:['dream-engine:']});
 expect(route('/runtime/1/core.js')).toMatchObject({kind:'file',immutable:true});
 expect(route('/scene/scene_1/index.html')).toMatchObject({kind:'html'});expect(route('/scene/scene_1/bundle.js')).toMatchObject({kind:'file',path:join(generated,'scene.js')});
 expect(route('/scene/scene_1/files/logos/brand.png')).toMatchObject({kind:'file',path:join(store,hash)});expect(route('/scene/scene_1/media/clip')).toMatchObject({kind:'file',path:join(root,'clip.mp4')});
 for(const bad of ['/runtime/1/../../clip.mp4','/runtime/1/%2e%2e/%2e%2e/clip.mp4','/scene/clip/index.html','/scene/scene_1/files/missing.png','/scene/scene_1/media/scene_1','/scene/scene_1/../clip.mp4','/other/x','/draft/'+'c'.repeat(32)+'/index.html'])expect(route(bad).kind,bad).toBe('missing');
 drafts.set('c'.repeat(32),sceneFromAsset(scene)!);drafts.set('d'.repeat(32),sceneFromAsset(scene)!);expect(route('/draft/'+'c'.repeat(32)+'/index.html').kind).toBe('missing');expect(route('/draft/'+'d'.repeat(32)+'/index.html').kind).toBe('html');
});
