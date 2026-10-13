import {existsSync,readFileSync,statSync} from 'node:fs';
import {resolve,relative,isAbsolute} from 'node:path';
/** Only Export renders the edit. A command that renders scenes or the composition (the Remotion CLI's render or still, or
 * the renderer API in a script the command runs) is refused before it starts; scenes and keyframes already play live. */
const cli=/\b(?:remotion|@remotion\/cli)\s+(?:render|still|benchmark)\b/i,api=/\brender(?:Media|Still|Frames)\s*\(|@remotion\/renderer|@remotion\/lambda/;
const scripts=/[^\s'"`;|&()<>]+\.(?:m?[jt]sx?|cjs|py)\b/g;
export const RENDER_REFUSAL='Only Export renders the edit. This command renders scenes or the composition (a Remotion render or still, or the renderer API). Scenes and keyframes appear in the player as soon as they are published: publish instead, and let the user Export.';
export function rendersTheEdit(command:string,root:string,cwd='.'){
 if(cli.test(command)||api.test(command))return true;
 const base=resolve(root,cwd);
 for(const name of command.match(scripts)??[]){
  const path=resolve(base,name),inside=relative(root,path);if(inside.startsWith('..')||isAbsolute(inside)||!existsSync(path))continue;
  try{if(statSync(path).size<2_000_000){const text=readFileSync(path,'utf8');if(api.test(text)||cli.test(text))return true;}}catch{}
 }
 return false;
}
