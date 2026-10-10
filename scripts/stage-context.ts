import {cp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileHash} from '../apps/desktop/src/main/download';
const source=resolve('apps/ingest-worker/build/context-dist/dream-context'),destination=resolve('apps/desktop/resources/staged/context');
await mkdir(destination,{recursive:true});await cp(source,destination,{recursive:true});
const executable=process.platform==='win32'?'dream-context.exe':'dream-context';
await writeFile(join(destination,'runtime-manifest.json'),JSON.stringify({platform:process.platform,arch:process.arch,library:'claude-real-video',version:'0.10.7',pipeline:'crv-0.10.7-dream-1',executableSha256:await fileHash(join(destination,executable)),requirements:await readFile(resolve('apps/ingest-worker/context-requirements.txt'),'utf8')},null,2));
console.log('Fast media-context runtime staged.');
