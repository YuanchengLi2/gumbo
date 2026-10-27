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
.move{position:fixed;pointer-events:none;max-width:240px;padding:1px 7px 1px 3px;border-radius:6px;font:11.5px/1.55 "Segoe UI Variable Text","Segoe UI",system-ui,-apple-system,sans-serif;color:#2a2a2a;background:rgba(255,255,255,.9);border:1px solid rgba(0,0,0,.09);box-shadow:0 1px 4px rgba(0,0,0,.08);display:flex;gap:5px;align-items:center;white-space:nowrap;animation:in .12s ease-out}
.move .text{overflow:hidden;text-overflow:ellipsis}
.move kbd{font:10px Consolas,ui-monospace,monospace;border:1px solid rgba(0,0,0,.14);border-radius:3px;padding:0 3px;color:#666;background:#f6f6f6}
.tab-ring{position:fixed;pointer-events:none;border:1.5px solid rgba(0,0,0,.32);border-radius:7px;box-shadow:0 0 0 2px rgba(255,255,255,.45);animation:in .12s ease-out}
.tab-ring.to{border-style:dashed}
.tab-ring.dot{border-radius:50%;border-width:2px}
@keyframes in{from{opacity:0;transform:translateY(-2px)}to{opacity:1;transform:none}}
@media (prefers-color-scheme:dark){.move{color:#e6e6e6;background:rgba(35,35,35,.9);border-color:rgba(255,255,255,.12)}.move kbd{color:#bbb;background:#2c2c2c;border-color:rgba(255,255,255,.18)}.chip{color:#eee;background:#232323;border-color:rgba(255,255,255,.12)}.chip kbd,.card kbd{color:#bbb;background:#2c2c2c;border-color:rgba(255,255,255,.18)}}
`;
export function layer():ShadowRoot{
 if(root&&root.host.isConnected)return root;
 const host=document.createElement('gumbo-layer');
 host.style.cssText='all:initial;position:fixed;top:0;left:0;width:0;height:0;margin:0;padding:0;border:0;overflow:visible;background:transparent;z-index:2147483647;pointer-events:none';
 root=host.attachShadow({mode:'closed'});
 const style=document.createElement('style');style.textContent=css;root.appendChild(style);
 const div=document.createElement('div');div.className='layer';root.appendChild(div);
 host.setAttribute('popover','manual');
 (document.documentElement??document.body).appendChild(host);
 useMirrorRoot(root);
 raise();
 return root;
}
/** A modal dialog, a menu or a popup the page opens sits in the browser's top layer, above any element whatever its
 * z-index, and a modal dialog makes the rest of the page inert. So Gumbo's layer goes inside the topmost open modal
 * dialog (its hints and card are then seen and can be used there), and otherwise into the top layer itself, shown again
 * after the page's own popups so it stays above them. Called whenever Gumbo shows something. */
export function raise(){
 const host=root?.host as HTMLElement|undefined;if(!host?.isConnected)return;
 const modal=[...document.querySelectorAll('dialog[open]')].filter(d=>{try{return d.matches(':modal');}catch{return false;}}).at(-1);
 const home=modal??document.documentElement;
 const open=()=>{try{return host.matches(':popover-open');}catch{return false;}};
 if(host.parentElement!==home){if(open())host.hidePopover();home.appendChild(host);}
 if(modal||!host.showPopover)return;
 // Above the page's own popups: shown again when one is open (the last one shown is on top).
 try{if(open()&&document.querySelector(':popover-open:not(gumbo-layer)'))host.hidePopover();if(!open())host.showPopover();}catch{}
}
export const surface=()=>layer().querySelector('.layer') as HTMLDivElement;
/** Adds more CSS to the layer (Ctrl+K's card brings its own). */
export function addStyle(text:string){const s=document.createElement('style');s.textContent=text;layer().appendChild(s);}
