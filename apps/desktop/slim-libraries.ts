import {existsSync,readdirSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';

/** Python packages the installer leaves out and the installed app downloads after its first start (src/main/
 * extra-libraries.ts): scipy and OpenCV were 230 MB and 2,600 files of the install, and the agent's commands rarely import
 * them (2 and 6 of 96 scripts on October 19). */
export const DEFERRED_PYTHON=['scipy','opencv-python-headless'] as const;
const deferredFolders:Record<(typeof DEFERRED_PYTHON)[number],RegExp>={scipy:/^scipy([-.]|$)/i,'opencv-python-headless':/^(cv2|opencv_python_headless)([-.]|$)/i};
// matplotlib and what only it needs: not among the shared libraries (libraries.json), and no command imported them.
const unlisted=/^(matplotlib|mpl_toolkits|contourpy|kiwisolver|cycler|fonttools|pyparsing|dateutil|python_dateutil|six)([-.]|$)/i;

/** Slims the packaged copy of the shared libraries: what the agent's commands never use goes (test suites, type stubs, C
 * headers, docs and source maps; wheel files left from staging), and the deferred packages are removed and listed in
 * deferred.json so the app knows to fetch them. Bytecode caches stay: without them every script's imports start slower. */
export function slimLibraries(libraries:string){
 const python=join(libraries,'python');
 if(existsSync(python)){
  for(const name of readdirSync(python))if(/\.whl$/i.test(name)||unlisted.test(name))rmSync(join(python,name),{recursive:true,force:true});
  const manifest=existsSync(join(libraries,'libraries.json'))?JSON.parse(readFileSync(join(libraries,'libraries.json'),'utf8')):{};
  const deferred:Record<string,string>={};
  for(const pkg of DEFERRED_PYTHON){
   const version=manifest.python?.[pkg];if(typeof version!=='string')continue;deferred[pkg]=version;
   for(const name of readdirSync(python))if(deferredFolders[pkg].test(name))rmSync(join(python,name),{recursive:true,force:true});
  }
  writeFileSync(join(libraries,'deferred.json'),JSON.stringify({python:deferred}));
  prune(python,(name,folder)=>folder?name==='tests':/\.(pyi|pxd|h|hpp)$/i.test(name));
 }
 prune(join(libraries,'node_modules'),(name,folder)=>!folder&&/\.(d\.[cm]?ts|map|md|markdown)$/i.test(name)&&!/^(license|licence|notice)/i.test(name));
}

function prune(root:string,remove:(name:string,folder:boolean)=>boolean){
 if(!existsSync(root))return;
 for(const entry of readdirSync(root,{withFileTypes:true})){
  const path=join(root,entry.name),folder=entry.isDirectory();
  if(remove(entry.name,folder))rmSync(path,{recursive:true,force:true});else if(folder)prune(path,remove);
 }
}
