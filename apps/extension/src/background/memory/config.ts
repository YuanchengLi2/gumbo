import {getSealed} from '../db';
import {defaults,type MemoryConfig} from '../../shared/memory-config';
export {defaults,type MemoryConfig};
/** Every number memory and Tab are tuned by, in one place: the ranking's weights, the project threshold, how often Tab
 * asks while typing, how long a beat is. The defaults below are a start; any of them can be overridden in
 * chrome.storage.local ('memoryConfig', a partial object of the same shape), which is how scripts/tab-eval.ts sweeps
 * them, and the debug view shows the values in effect. The project join threshold comes from this computer's own
 * history when it has been calibrated (projects.ts), unless overridden. */
export type Calibration={at:number;pairs:{chain:number;random:number};chain:number[];random:number[];threshold:number};
let cached:{at:number;value:MemoryConfig}|undefined;
const merge=(base:any,over:any):any=>{if(!over||typeof over!=='object')return base;const out={...base};for(const k of Object.keys(over))out[k]=typeof base[k]==='object'&&base[k]?merge(base[k],over[k]):over[k];return out;};
export async function config():Promise<MemoryConfig>{
 if(cached&&Date.now()-cached.at<10_000)return cached.value;
 const [stored,calibration]=await Promise.all([chrome.storage.local.get('memoryConfig').then(r=>r.memoryConfig).catch(()=>undefined),getSealed<Calibration>('calibration').catch(()=>undefined)]);
 let value=merge(defaults,calibration?{projects:{join:calibration.threshold}}:undefined) as MemoryConfig;
 value=merge(value,stored);cached={at:Date.now(),value};return value;
}
chrome.storage.onChanged.addListener((changes,area)=>{if(area==='local'&&changes.memoryConfig)cached=undefined;});
export const forgetConfig=()=>{cached=undefined;};
