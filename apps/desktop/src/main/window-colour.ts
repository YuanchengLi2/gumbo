import {app,nativeTheme} from 'electron';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';

/** The colour behind the page the last time the app ran (its theme's), so the window starts in it rather than in the
 * system's: a dark Gumbo on a light Windows otherwise opened white at the edges. */
const file=()=>join(app.getPath('userData'),'window-colour.json');
export function lastBackground(){
 try{const colour=JSON.parse(readFileSync(file(),'utf8')).background;if(/^#[0-9a-f]{6}$/i.test(colour))return colour as string;}catch{}
 return nativeTheme.shouldUseDarkColors?'#111112':'#ffffff';
}
export function saveBackground(colour:string){try{writeFileSync(file(),JSON.stringify({background:colour}));}catch{}}
/** Whether a #rrggbb colour is dark (for the window controls' symbols on it). */
export const isDark=(colour:string)=>{const n=parseInt(colour.slice(1),16);return((n>>16)*299+((n>>8)&255)*587+(n&255)*114)/1000<128;};
