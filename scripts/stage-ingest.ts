import {cp,mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {fileHash} from '../apps/desktop/src/main/download';

const source=resolve('apps/ingest-worker/build/dist/dream-ingest');
const destination=resolve('apps/desktop/resources/staged/ingest');
const binary=process.platform==='win32'?'dream-ingest.exe':'dream-ingest';
await mkdir(destination,{recursive:true});
await cp(source,destination,{recursive:true});
const manifest={platform:process.platform,arch:process.arch,python:'3.11',pipelineRevision:'dream-ingest-2',executableSha256:await fileHash(join(destination,binary)),dependencyLockSha256:await fileHash(resolve('apps/ingest-worker/uv.lock'))};
await writeFile(join(destination,'runtime-manifest.json'),JSON.stringify(manifest,null,2));
console.log('Verified analysis runtime staged with its dependency-lock hash.');
