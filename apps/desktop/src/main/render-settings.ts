import {cpus} from 'node:os';

/** Frame settings shared by every export. Opaque video renders JPEG frames (PNG costs ~70% more per frame for no visible
 * gain once encoded to H.264); only transparent output needs PNG. Concurrency follows the machine, half its cores
 * (2 to 8), and DREAM_RENDER_CONCURRENCY still overrides it. */
export const renderConcurrency=()=>{const set=Number(process.env.DREAM_RENDER_CONCURRENCY);return set>0?Math.floor(set):Math.min(8,Math.max(2,Math.floor(cpus().length/2)));};
export const frameFormat=(alpha=false)=>alpha?{imageFormat:'png' as const}:{imageFormat:'jpeg' as const,jpegQuality:90};
