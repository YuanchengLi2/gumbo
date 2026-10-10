import {Script} from 'node:vm';
import {existsSync,readFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {workspacePath} from '../../../packages/project-db/src/workspace-store';

const external=/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i;
const attribute=(attributes:string,name:string)=>new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'>]+))`,'i').exec(attributes)?.slice(1).find(v=>v!==undefined);
/** Replace local <script src> and stylesheet links with their workspace file contents, so the published scene is self-contained.
 * Paths resolve relative to the scene file, then to the workspace root, and must stay inside the workspace. */
export function inlineLocalAssets(html:string,scenePath:string,root:string){
 const read=(reference:string,kind:string)=>{
  if(external.test(reference))throw new Error(`Scenes cannot load external ${kind} (${reference}). Bundle the library with bundle_scene and reference the local output file.`);
  const clean=reference.split(/[?#]/)[0],candidates=[join(dirname(scenePath),clean),clean.replace(/^\/+/,'')];
  for(const candidate of candidates){const path=workspacePath(root,candidate);if(existsSync(path))return readFileSync(path,'utf8');}
  throw new Error(`The scene references ${reference}, which does not exist in the workspace.`);
 };
 const scripts=html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi,(whole,attributes:string,body:string)=>{
  const src=attribute(attributes,'src');if(src===undefined)return whole;
  if(body.trim())throw new Error('A script with src must not also contain inline code.');
  const rest=attributes.replace(/(?:^|\s)src\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'>]+)/i,'');
  return `<script${rest}>${read(src,'scripts').replace(/<\/script/gi,'<\\/script')}</script>`;
 });
 return scripts.replace(/<link\b([^>]*)>/gi,(whole,attributes:string)=>{
  if(!/(?:^|\s)rel\s*=\s*["']?stylesheet/i.test(attributes))return whole;const href=attribute(attributes,'href');if(href===undefined)return whole;
  return `<style>${read(href,'stylesheets').replace(/<\/style/gi,'<\\/style')}</style>`;
 });
}

/** Syntax validation only; scene code never executes in the project service. */
export function validateSceneSource(html:string){
 let scripts=0;
 for(const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi)){
  const attributes=match[1],type=/(?:^|\s)type\s*=\s*["']?([^\s"'>]+)/i.exec(attributes)?.[1]?.toLowerCase();
  if(/(?:^|\s)src\s*=/i.test(attributes))throw new Error('Inline the scene scripts or reference local workspace files.');
  if(type==='module')throw new Error('Use bundle_scene to bundle module imports into an IIFE, then reference the bundle with a plain <script src>.');
  if(type&&!['text/javascript','application/javascript'].includes(type))continue;
  scripts++;try{new Script(match[2],{filename:`scene-script-${scripts}.js`});}catch(error){throw new Error('Scene JavaScript could not compile: '+(error as Error).message);}
 }
 if(!scripts||!html.includes('renderFrame'))throw new Error('A live scene must define window.renderFrame(frame, fps).');
}
