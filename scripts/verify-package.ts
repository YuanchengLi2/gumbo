import {statFile,extractFile} from '@electron/asar';
import {existsSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join,normalize} from 'node:path';
import {fileHash} from '../apps/desktop/src/main/download';

const root=resolve(process.argv[2]??(process.platform==='win32'?'apps/desktop/out/Dream-win32-x64':'apps/desktop/out/Dream-darwin-arm64/Dream.app'));
const resources=join(root,process.platform==='darwin'?'Contents/Resources':'resources'),archive=join(resources,'app.asar');
const pkg=JSON.parse(extractFile(archive,'package.json').toString());
for(const entry of [pkg.main,'.vite/build/service.js','.vite/build/procedural-worker.js','.vite/build/component-compile.js','.vite/build/preload.js','.vite/renderer/main_window/index.html'])if(!statFile(archive,normalize(entry)))throw new Error(`Missing packaged entry ${entry}`);
if(!existsSync(join(resources,'notices','OpenCut-LICENSE.txt')))throw new Error('Missing OpenCut attribution.');
const staged=join(resources,'staged'),suffix=process.platform==='win32'?'.exe':'';
const required=[`media-runtime/ffmpeg${suffix}`,`media-runtime/ffprobe${suffix}`,`render-browser/chrome-headless-shell${suffix}`,`compositor/remotion${suffix}`,`compositor/ffmpeg${suffix}`,`compositor/ffprobe${suffix}`,'remotion/index.html','sandbox/entry.js','sandbox/react.js','sandbox/jsx-runtime.js','sandbox/remotion.js',`ingest/dream-ingest${suffix}`];
for(const file of required)if(!existsSync(join(staged,file)))throw new Error(`Missing offline runtime ${file}`);
// Every shipped scene engine version must be complete and match its manifest, or published scenes would not play.
const engineRoot=join(staged,'engine');if(!existsSync(join(engineRoot,'1','manifest.json')))throw new Error('Missing scene engine runtime 1.');
for(const version of ['1']){const engine=JSON.parse(readFileSync(join(engineRoot,version,'manifest.json'),'utf8'));for(const chunk of ['core','three','d3','icons','noise'])if(!engine.files[chunk+'.js'])throw new Error(`Scene engine ${version} is missing ${chunk}.js.`);for(const [file,entry] of Object.entries(engine.files as Record<string,{sha256:string}>))if(await fileHash(join(engineRoot,version,file))!==entry.sha256)throw new Error(`Scene engine ${version} checksum mismatch: ${file}`);}
const vectorName=process.platform==='win32'?'sqlite-vec-windows-x64/vec0.dll':'sqlite-vec-darwin-arm64/vec0.dylib';
if(!existsSync(join(resources,'app.asar.unpacked/node_modules',vectorName)))throw new Error('Missing platform SQLite vector extension.');
const manifest=JSON.parse(readFileSync(join(staged,'staged-manifest.json'),'utf8'));
if(process.platform==='win32'){
 const creation=join(staged,'creation'),runtime=JSON.parse(readFileSync(join(creation,'manifest.json'),'utf8')),qualification=JSON.parse(readFileSync(join(creation,'qualification.json'),'utf8'));
 for(const [file,hash] of Object.entries(runtime.files))if(await fileHash(join(creation,file))!==hash)throw new Error('Creation runtime checksum mismatch: '+file);
 if(!qualification.passed||qualification.manifestHash!==await fileHash(join(creation,'manifest.json')))throw new Error('Creation runtime has not passed qualification for this package.');
}
if(await fileHash(join(staged,`media-runtime/ffmpeg${suffix}`))!==manifest.ffmpegSha256)throw new Error('Packaged FFmpeg hash differs from the staged manifest.');
if(await fileHash(join(staged,`render-browser/chrome-headless-shell${suffix}`))!==manifest.browserSha256)throw new Error('Packaged rendering-browser hash differs from the staged manifest.');
const compositor=JSON.parse(readFileSync(join(staged,'compositor/package.json'),'utf8'));
if(compositor.version!==manifest.remotion)throw new Error('Remotion and compositor versions differ.');
const report={package:root,version:pkg.version,platform:process.platform,arch:process.arch,offlineResources:required.length,vectorExtension:true,manifestHashes:true,passed:true};
mkdirSync('artifacts',{recursive:true});writeFileSync('artifacts/package-verification.json',JSON.stringify(report,null,2));console.log(report);
