import {CHUNKS,type Chunk} from './modules';

export type HostConfig={assetId:string;revisionId:string;width:number;height:number;fps:number;durationInFrames:number;chunks:readonly string[];props?:Record<string,unknown>;transparent?:boolean;beats?:Record<string,number[]>};

const attr=(value:string)=>value.replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
// JSON inside a non-executed script element: only "</script" and HTML comment openers need breaking up.
const json=(value:unknown)=>JSON.stringify(value).replace(/</g,'\\u003c').replace(/>/g,'\\u003e').replace(/&/g,'\\u0026').replace(/\u2028/g,'\\u2028').replace(/\u2029/g,'\\u2029');

/** Scene documents may load code and files only from the engine's own origin (runtime chunks, the compiled scene and
 * its resources) plus data and blob URLs. Nothing reaches the network. */
export function engineCsp(sources:readonly string[]){
 const s=sources.join(' ');
 return[`default-src 'none'`,`script-src ${s}`,`style-src ${s} 'unsafe-inline'`,`img-src ${s} data: blob:`,`media-src ${s} data: blob:`,`font-src ${s} data: blob:`,`connect-src ${s} data: blob:`,`worker-src blob:`,`base-uri 'none'`,`form-action 'none'`].join('; ');
}

/** The document that runs one engine scene. runtimeBase and sceneBase are usually relative, so the same document works
 * from dream-engine:// in the player and from the loopback render server during export; cspSources names that origin. */
export function engineHostHtml(config:HostConfig,options:{runtimeBase:string;sceneBase:string;cspSources:readonly string[]}){
 const chunks=CHUNKS.filter(chunk=>chunk==='core'||config.chunks.includes(chunk)) as Chunk[];
 const csp=engineCsp(options.cspSources),runtime=options.runtimeBase.replace(/\/$/,''),scene=options.sceneBase.replace(/\/$/,'');
 const background=config.transparent?'transparent':'#000';
 const html=`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${attr(csp)}"><link rel="stylesheet" href="${attr(runtime+'/fonts.css')}"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:${background}}*{box-sizing:border-box}#root{position:absolute;left:0;top:0;width:${Math.round(config.width)}px;height:${Math.round(config.height)}px;overflow:hidden}</style><script type="application/json" id="dream-scene-config">${json(config)}</script></head><body><div id="root"></div>${chunks.map(chunk=>`<script src="${attr(`${runtime}/${chunk}.js`)}"></script>`).join('')}<script src="${attr(scene+'/bundle.js')}"></script></body></html>`;
 return{html,csp};
}
