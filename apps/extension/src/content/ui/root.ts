import {useMirrorRoot} from '../fields/caret';
/** Gumbo's layer in a page: one element under <html> holding a closed shadow root, so the page's styles never reach
 * Gumbo's UI and Gumbo's never reach the page. It takes no space and lets clicks through except on its own controls. */
let root:ShadowRoot|undefined;
const css=`
:host{all:initial}
.layer{position:fixed;inset:0;pointer-events:none;z-index:2147483647}
.ghost{position:fixed;pointer-events:none;white-space:pre-wrap;overflow-wrap:break-word;word-break:normal;margin:0;padding:0;border:0;transform-origin:0 0;text-rendering:optimizeLegibility}
.chip{position:fixed;pointer-events:auto;max-width:420px;padding:5px 9px 5px 10px;border-radius:9px;font:13px/1.4 "Segoe UI Variable Text","Segoe UI",system-ui,-apple-system,sans-serif;color:#1d1d1d;background:#fff;border:1px solid rgba(0,0,0,.1);box-shadow:0 6px 24px rgba(0,0,0,.14),0 1px 3px rgba(0,0,0,.08);display:flex;gap:8px;align-items:baseline;animation:in .12s ease-out}
.chip .text{overflow:hidden;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical}
.chip kbd,.card kbd{font:11px Consolas,ui-monospace,monospace;border:1px solid rgba(0,0,0,.14);border-bottom-width:2px;border-radius:4px;padding:0 4px;color:#555;background:#fafafa;white-space:nowrap}
.chip .progress{color:#777}
.tab-ring{position:fixed;pointer-events:none;border:1.5px solid rgba(0,0,0,.55);border-radius:7px;box-shadow:0 0 0 3px rgba(255,255,255,.7);animation:in .12s ease-out}
.tab-ring.to{border-style:dashed}
.tab-ring.dot{border-radius:50%;border-width:2px}
@keyframes in{from{opacity:0;transform:translateY(-2px)}to{opacity:1;transform:none}}
@media (prefers-color-scheme:dark){.chip{color:#eee;background:#232323;border-color:rgba(255,255,255,.12)}.chip kbd,.card kbd{color:#bbb;background:#2c2c2c;border-color:rgba(255,255,255,.18)}}
`;
export function layer():ShadowRoot{
 if(root&&root.host.isConnected)return root;
 const host=document.createElement('gumbo-layer');
 host.style.cssText='all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;pointer-events:none';
 root=host.attachShadow({mode:'closed'});
 const style=document.createElement('style');style.textContent=css;root.appendChild(style);
 const div=document.createElement('div');div.className='layer';root.appendChild(div);
 (document.documentElement??document.body).appendChild(host);
 useMirrorRoot(root);
 return root;
}
export const surface=()=>layer().querySelector('.layer') as HTMLDivElement;
/** Adds more CSS to the layer (Ctrl+K's card brings its own). */
export function addStyle(text:string){const s=document.createElement('style');s.textContent=text;layer().appendChild(s);}
