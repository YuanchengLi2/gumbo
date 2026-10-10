/** The same isolated, frame-driven document runs in the player and Export. */
export function liveSceneDocument(html:string){
 const bridge=`<script>
 (() => {
  let pending, running = false;
  const send = (value) => parent.postMessage({dreamScene:true,...value}, '*');
  addEventListener('error', e => send({error:e.message}));
  addEventListener('unhandledrejection', e => send({error:String(e.reason?.message || e.reason)}));
  async function draw() {
   if(running) return;
   running = true;
   while(pending) {
    const request = pending; pending = undefined;
    try {
     if(typeof window.renderFrame !== 'function') throw Error('Scene must define window.renderFrame(frame, fps).');
     await window.renderFrame(request.frame, request.fps);
     await document.fonts.ready;
     await Promise.all(Array.from(document.images).map(img => img.decode()));
     send({requestId:request.requestId});
    } catch(error) { send({requestId:request.requestId,error:String(error.message || error)}); }
   }
   running = false;
  }
  addEventListener('message', e => {
   if(e.source !== parent || !e.data?.dreamScene || e.data.type !== 'frame') return;
   pending = e.data; void draw();
  });
  addEventListener('load', () => send({ready:true}));
 })();
 </script>`;
 // An opaque sandbox origin plus CSP isolates authored code from the editor.
 return `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; media-src 'none'; connect-src 'none'; base-uri 'none'; form-action 'none'"><style>html,body{margin:0;width:100%;height:100%;overflow:hidden}*{box-sizing:border-box}</style>${bridge}${html}`;
}
