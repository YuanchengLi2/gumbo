import {readFileSync} from 'node:fs';
import {join} from 'node:path';

/** What Roux's commands can use on the web, for context/environment.json, as the desktop's workspace-environment.ts
 * says what Gumbo ships. They run in the browser sandbox (packages/web-sandbox) over this project's folder only. */
export function workspaceEnvironment(root:string){
 let nodeDependencies:Record<string,string>={};try{const pkg=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));nodeDependencies={...pkg.dependencies,...pkg.devDependencies};}catch{}
 return{
  preview:'Engine scenes (React components in src/) run live in the player. No frame rendering or video encoding in chat. Only Export renders.',
  runtime:'browser sandbox',
  bundled:['sh with the Unix tools','Python 3 (Pyodide)','pip (micropip)','ffmpeg and ffprobe (WebAssembly)','node (CommonJS)','esbuild','curl and wget'],
  pythonPackages:['numpy','Pillow','scipy','opencv-python','matplotlib'].map(name=>({name,loadsOnImport:true})),
  nodeDependencies,
  note:'Commands run in a sandbox in the browser, over this project\'s folder only. Python is Pyodide: numpy, Pillow, scipy, OpenCV and matplotlib load on import; pip installs pure-Python packages and Pyodide\'s own builds. ffmpeg and ffprobe are the WebAssembly builds, slower than native: keep encodes short and use them for checks and small conversions. node runs CommonJS from files in the workspace; npm, git and system package managers are not available. curl and wget reach sites that allow it from a browser (most media hosts do).'
 };
}
