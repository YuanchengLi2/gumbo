import type {HostConfig} from '../host-html';

let config:HostConfig|undefined;
// The core chunk's own URL locates the runtime folder (fonts, chunks), whatever base the document was served from.
const script=typeof document!=='undefined'?(document.currentScript as HTMLScriptElement|null):null;
export const runtimeBase=script?.src?new URL('.',script.src).href:'';
export function readConfig():HostConfig{
 const element=document.getElementById('dream-scene-config');if(!element?.textContent)throw new Error('The scene document has no configuration.');
 config=JSON.parse(element.textContent) as HostConfig;return config;
}
export const sceneConfig=()=>{if(!config)throw new Error('The scene is not mounted yet.');return config;};
