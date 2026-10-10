import {it,expect} from 'vitest';
import {mkdtempSync,mkdirSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {zipSync} from 'fflate';
import {ProjectDB} from '@dream/project-db';
import {CodeWorkspace} from '../../apps/project-service/src/code-workspace';
import {importResources,globMatcher,imageSize} from '../../apps/project-service/src/resource-import';
import {engineReference} from '../../packages/scene-engine/src/reference.generated';
import {engineReferenceModule} from '../../scripts/build-engine-reference';
import {png} from '../fixtures/engine-fixtures';

it('extracts only matching archive entries into resources with an index of sizes and image dimensions',()=>{
 const root=mkdtempSync(join(tmpdir(),'dream-resources-')),workspace=join(root,'Workspace');mkdirSync(workspace);
 const archive=join(root,'pack.jar');writeFileSync(archive,zipSync({'assets/pack/textures/stone.png':png(16,16,()=>[90,90,90]),'assets/pack/textures/wood.png':png(32,8,()=>[120,80,40]),'assets/pack/sounds/step.ogg':new Uint8Array(10),'META-INF/MANIFEST.MF':new Uint8Array(5)}));
 const result=importResources(workspace,{source:archive,include:['assets/*/textures/**/*.png'],into:'resources/blocks'});
 expect(result).toMatchObject({into:'resources/blocks',imported:2,skipped:[]});
 const index=JSON.parse(readFileSync(join(workspace,'resources/blocks/index.json'),'utf8'));
 expect(index.files).toEqual([{path:'resources/blocks/assets/pack/textures/stone.png',size:expect.any(Number),width:16,height:16},{path:'resources/blocks/assets/pack/textures/wood.png',size:expect.any(Number),width:32,height:8}]);
 expect(existsSync(join(workspace,'resources/blocks/assets/pack/sounds/step.ogg'))).toBe(false);
 expect(()=>importResources(workspace,{source:archive,into:'../escape'})).toThrow('folder name under resources/');
});

it('copies matching files from a folder, enforces the per-file limit and matches patterns like a shell',()=>{
 const root=mkdtempSync(join(tmpdir(),'dream-resources-dir-')),workspace=join(root,'Workspace'),source=join(root,'Brand');mkdirSync(workspace);mkdirSync(join(source,'logos/dark'),{recursive:true});
 writeFileSync(join(source,'logos/main.svg'),'<svg/>');writeFileSync(join(source,'logos/dark/main.svg'),'<svg/>');writeFileSync(join(source,'notes.txt'),'x');writeFileSync(join(source,'huge.svg'),Buffer.alloc(25*1024*1024));
 const result=importResources(workspace,{source,include:['**/*.svg'],into:'brand'});
 expect(result.imported).toBe(2);expect(result.skipped).toEqual(['huge.svg (larger than 24 MB)']);
 const match=globMatcher(['*.png','sounds/**']);expect(match('a.PNG')).toBe(true);expect(match('dir/a.png')).toBe(false);expect(match('sounds/x/y.ogg')).toBe(true);
 expect(imageSize(png(3,5,()=>[0,0,0]))).toEqual({width:3,height:5});
});

it('asks for computer access before reading, through the existing file permission',async()=>{
 const root=mkdtempSync(join(tmpdir(),'dream-resources-perm-')),db=new ProjectDB(root,'Perm');let granted=false;
 const ws=new CodeWorkspace(db,{run:async()=>{throw Error('unexpected');},ffmpeg:'',ffprobe:'',files:async request=>request.action==='authorize_import'&&!granted?{permissionRequired:true} as any:{paths:(request as any).paths}},()=>{});
 try{await ws.initialize();const source=join(root,'pic.png');writeFileSync(source,png(4,4,()=>[1,2,3]));
  await expect(ws.execute('import_resources',{source,into:'pictures'},'r1','turn',new AbortController().signal)).rejects.toThrow();
  granted=true;const result=await ws.execute('import_resources',{source,into:'pictures'},'r2','turn',new AbortController().signal);expect(result.imported).toBe(1);expect(existsSync(join(root,'Workspace/resources/pictures/pic.png'))).toBe(true);
 }finally{db.close();}
});

it('keeps the prompt copy of the engine reference identical to reference/api.md',()=>{
 expect(engineReferenceModule(readFileSync('packages/scene-engine/reference/api.md','utf8'))).toBe(readFileSync('packages/scene-engine/src/reference.generated.ts','utf8'));
 expect(engineReference).toContain('## @dream/engine');expect(engineReference.length).toBeLessThan(24000);
});
