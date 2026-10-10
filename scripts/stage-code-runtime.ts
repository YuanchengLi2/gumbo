import {mkdir,writeFile,readFile,rename,rm,cp,readdir} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {patchCodeNode} from './patch-code-node';

const root=resolve('apps/desktop/resources/staged/creation'),downloads=resolve('artifacts/code-runtime-tools');
const sha=(bytes:Buffer)=>createHash('sha256').update(bytes).digest('hex');
async function run(exe:string,args:string[]){await new Promise<void>((ok,fail)=>{const p=spawn(exe,args,{stdio:'inherit',windowsHide:true});p.on('error',fail);p.on('exit',c=>c===0?ok():fail(new Error(`${exe} exited ${c}`)));});}
async function download(url:string,path:string,expected?:string){const bytes=existsSync(path)?await readFile(path):Buffer.from(await (await fetch(url).then(r=>{if(!r.ok)throw new Error(`${url}: ${r.status}`);return r;})).arrayBuffer());const hash=sha(bytes);if(expected&&hash!==expected.toLowerCase())throw new Error('Runtime checksum mismatch: '+url);await writeFile(path,bytes);return hash;}
const psQuote=(s:string)=>"'"+s.replaceAll("'","''")+"'";
async function unzip(path:string,to:string){await run('powershell.exe',['-NoProfile','-NonInteractive','-Command',`Expand-Archive -LiteralPath ${psQuote(path)} -DestinationPath ${psQuote(to)} -Force`]);}
export async function stageCodeRuntime(){
 if(process.platform!=='win32')throw new Error('The creation executor is qualified for Windows only.');
 await mkdir(root,{recursive:true});await mkdir(downloads,{recursive:true});
 const nodeVersion='24.19.0',pythonVersion='3.13.16',nodeFile=`node-v${nodeVersion}-win-x64.zip`,nodeBase=`https://nodejs.org/dist/v${nodeVersion}/`;
 const sums=await (await fetch(nodeBase+'SHASUMS256.txt')).text(),nodeHash=sums.split('\n').find(l=>l.endsWith(' '+nodeFile))?.split(/\s+/)[0];if(!nodeHash||!/^[a-f0-9]{64}$/.test(nodeHash))throw new Error('Official Node checksum is missing.');
 await download(nodeBase+nodeFile,join(downloads,nodeFile),nodeHash);
 if(!existsSync(join(root,'node','node.exe'))){await unzip(join(downloads,nodeFile),root);await rename(join(root,`node-v${nodeVersion}-win-x64`),join(root,'node'));}
 const upstreamExeHash=sums.split('\n').find(line=>line.endsWith(' win-x64/node.exe'))?.split(/\s+/)[0];if(!upstreamExeHash)throw new Error('Official Node executable checksum is missing.');
 const upstreamExe=join(downloads,`node-${nodeVersion}-upstream.exe`);await download(nodeBase+'win-x64/node.exe',upstreamExe,upstreamExeHash);await cp(upstreamExe,join(root,'node','node.exe'));
 await cp('apps/desktop/native/creation-host/dream-render.cjs',join(root,'node','dream-render.cjs'));await writeFile(join(root,'node','dream-render.cmd'),'@echo off\r\n\"%~dp0node.exe\" \"%~dp0dream-render.cjs\" %*\r\n');
 const patchedNode=process.env.DREAM_CREATION_NODE;if(patchedNode){await cp(resolve(patchedNode),join(root,'node','node.exe'));await run(join(root,'node','node.exe'),['--version']);}
 const nodePatch=patchedNode?{kind:'source-backport',sha256:sha(await readFile('patches/node24-libuv-appcontainer.patch'))}:await patchCodeNode(join(root,'node','node.exe'));
 const pythonFile=`python-${pythonVersion}-embed-amd64.zip`,pythonUrl=`https://www.python.org/ftp/python/${pythonVersion}/${pythonFile}`;
 // Python's signed release bundle contains the independently published archive digest.
 const signature=await fetch(pythonUrl+'.sigstore');if(!signature.ok)throw new Error('Python release signature bundle unavailable.');const bundle=await signature.json() as any;
 const payload=bundle.dsseEnvelope?.payload;const statement=payload?JSON.parse(Buffer.from(payload,'base64').toString('utf8')):undefined;
 const pythonHash=statement?.subject?.[0]?.digest?.sha256??(bundle.messageSignature?.messageDigest?.digest?Buffer.from(bundle.messageSignature.messageDigest.digest,'base64').toString('hex'):undefined);
 if(!pythonHash||!/^[a-f0-9]{64}$/.test(pythonHash))throw new Error('Official Python checksum is missing.');await download(pythonUrl,join(downloads,pythonFile),pythonHash);
 if(!existsSync(join(root,'python','python.exe'))){await unzip(join(downloads,pythonFile),join(root,'python'));}
 // Standard path initialization permits a per-project PYTHONPATH and pip target.
 const pth=join(root,'python','python313._pth');if(existsSync(pth))await rm(pth);
 const bootstrap=join(downloads,'get-pip.py');const pipHash=await download('https://bootstrap.pypa.io/get-pip.py',bootstrap);
 if(!existsSync(join(root,'python','Lib','site-packages','pip')))await run(join(root,'python','python.exe'),[bootstrap,'--no-warn-script-location']);
 await cp('apps/desktop/native/creation-host/python-sitecustomize.py',join(root,'python','Lib','site-packages','sitecustomize.py'));
 const dotnet=process.env.DREAM_DOTNET??join(downloads,'dotnet','dotnet.exe');await run(dotnet,['publish','--source','https://api.nuget.org/v3/index.json','apps/desktop/native/creation-host/CreationHost.csproj','-c','Release','-r','win-x64','--self-contained','true','-p:PublishSingleFile=true','-o',join(root,'host')]);
 const notices=resolve('apps/desktop/resources/notices/dotnet');await mkdir(notices,{recursive:true});for(const name of ['LICENSE.txt','ThirdPartyNotices.txt'])await cp(join(dirname(dotnet),name),join(notices,name));
 const files:Record<string,string>={};async function walk(dir:string,prefix=''){for(const item of await readdir(dir,{withFileTypes:true})){if(item.name==='manifest.json'||item.name==='qualification.json'||item.name==='__pycache__'||item.name.endsWith('.pyc'))continue;const name=prefix+item.name;if(item.isDirectory())await walk(join(dir,item.name),name+'/');else files[name]=sha(await readFile(join(dir,item.name)));}}await walk(root);
 const manifest={format:1,platform:'win32-x64',node:nodeVersion,python:pythonVersion,nodeAppContainerPatch:nodePatch,archives:{node:{url:nodeBase+nodeFile,sha256:nodeHash},python:{url:pythonUrl,sha256:pythonHash},pipBootstrap:{sha256:pipHash}},files};await writeFile(join(root,'manifest.json'),JSON.stringify(manifest,null,2));
 const packageManifest=resolve('apps/desktop/resources/runtime-manifest.json'),current=JSON.parse(await readFile(packageManifest,'utf8'));current.creation={node:nodeVersion,python:pythonVersion,platform:'win32-x64',manifest:'staged/creation/manifest.json',manifestSha256:sha(Buffer.from(JSON.stringify(manifest,null,2)))};await writeFile(packageManifest,JSON.stringify(current,null,2));console.log('Pinned creation runtimes staged and hashed.');
}
if(process.argv[1]?.replaceAll('\\','/').endsWith('/stage-code-runtime.ts'))await stageCodeRuntime();
