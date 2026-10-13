import type {MediaLayer} from '@dream/compositor';
import type {Asset} from '@dream/footage';
import {liveSceneDocument} from '../../../../../packages/composition/src/live-scene-document';

/** Coded motion graphics in the player: each scene runs in its own sandboxed document (an engine scene from
 * dream-engine://, a legacy HTML scene from its file), placed and scaled where the frame model puts its layer, and told
 * which of its frames to draw. Export captures the same documents frame by frame. */
export const sceneUrl=(a:Asset)=>`dream-engine://app/scene/${encodeURIComponent(a.id)}/index.html?r=${a.scene!.revisionId.slice(0,16)}`;
const legacyDocument=(a:Asset)=>fetch('dream-media://'+a.id+'/preview').then(r=>r.text()).then(liveSceneDocument);
type Live={wrap:HTMLDivElement;iframe:HTMLIFrameElement;asset:Asset;ready:boolean;frame:number;request:number;lastUsed:number;error?:string};

export class SceneLayers{
 private live=new Map<string,Live>();private alert=document.createElement('div');
 constructor(private container:HTMLElement){
  this.alert.setAttribute('role','alert');this.alert.style.cssText='position:absolute;left:12px;right:12px;bottom:12px;padding:10px 14px;border-radius:8px;background:#2a1215ee;color:#ffd9dc;font:13px/1.4 system-ui,sans-serif;display:none;z-index:1';
  container.appendChild(this.alert);window.addEventListener('message',this.receive);
 }
 private receive=(event:MessageEvent)=>{
  for(const scene of this.live.values()){if(event.source!==scene.iframe.contentWindow||!event.data?.dreamScene)continue;const data=event.data;
   if(data.ready){scene.ready=true;scene.error=undefined;this.send(scene);}
   else if(data.error){
    // Errors from a scene playing here reach the agent with its file and line, and show over the picture until the
    // scene loads again (a render error leaves it broken even though the frame request itself completes).
    if(data.fatal||data.requestId===scene.request)scene.error=String(data.error);
    window.dispatchEvent(new CustomEvent('dream:scene-error',{detail:{assetId:scene.asset.id,revisionId:scene.asset.scene?.revisionId,message:String(data.error),stack:data.stack}}));}
   this.showError();}
 };
 private showError(){const failed=[...this.live.values()].find(s=>s.error&&s.wrap.style.display!=='none');this.alert.style.display=failed?'block':'none';if(failed)this.alert.textContent=`Scene ${failed.asset.filename}: ${failed.error}`;}
 private send(scene:Live){if(scene.ready&&scene.frame>=0)scene.iframe.contentWindow?.postMessage({dreamScene:true,type:'frame',requestId:++scene.request,frame:scene.frame,fps:scene.asset.fps||30},'*');}
 private open(key:string,asset:Asset){
  const wrap=document.createElement('div'),iframe=document.createElement('iframe');
  wrap.style.cssText='position:absolute;left:0;top:0;overflow:hidden;transform-origin:0 0;pointer-events:none';
  iframe.title=asset.filename;iframe.setAttribute('sandbox','allow-scripts');iframe.style.cssText=`position:absolute;border:0;background:transparent;pointer-events:none;transform-origin:0 0;width:${asset.width}px;height:${asset.height}px`;
  if(asset.scene?.format==='engine')iframe.src=sceneUrl(asset);
  else void legacyDocument(asset).then(html=>{iframe.srcdoc=html;});
  wrap.appendChild(iframe);const scene:Live={wrap,iframe,asset,ready:false,frame:-1,request:0,lastUsed:0};this.live.set(key,scene);return scene;
 }
 /** Shows the scene layers of a frame, in order, at the display's scale (CSS pixels per frame pixel). */
 update(layers:MediaLayer[],assets:Map<string,Asset>,scale:number){
  const now=performance.now();
  layers.forEach((layer,order)=>{const asset=assets.get(layer.assetId);if(!asset?.scene)return;
   let scene=this.live.get(layer.key);if(scene&&scene.asset.scene?.revisionId!==asset.scene.revisionId){scene.wrap.remove();this.live.delete(layer.key);scene=undefined;}
   scene??=this.open(layer.key,asset);scene.lastUsed=now;
   if(this.container.children[order]!==scene.wrap)this.container.insertBefore(scene.wrap,this.container.children[order]??this.alert);
   const m=layer.transform,k=scale,cw=layer.rect.w/Math.max(1e-9,layer.uv.w),ch=layer.rect.h/Math.max(1e-9,layer.uv.h);
   Object.assign(scene.wrap.style,{display:'block',width:layer.rect.w+'px',height:layer.rect.h+'px',opacity:String(layer.opacity),transform:`matrix(${m[0]*k},${m[1]*k},${m[2]*k},${m[3]*k},${m[4]*k},${m[5]*k}) translate(${layer.rect.x}px,${layer.rect.y}px)`});
   Object.assign(scene.iframe.style,{left:-layer.uv.x*cw+'px',top:-layer.uv.y*ch+'px',transform:`scale(${cw/asset.width},${ch/asset.height})`});
   const frame=layer.frameIndex??0;if(frame!==scene.frame){scene.frame=frame;this.send(scene);}
  });
  // A scene not shown for a few seconds is closed; one just off screen is hidden but kept, so it returns at once.
  for(const [key,scene] of this.live){if(scene.lastUsed===now)continue;scene.wrap.style.display='none';if(now-scene.lastUsed>4000){scene.wrap.remove();this.live.delete(key);}}
  this.showError();
 }
 destroy(){window.removeEventListener('message',this.receive);for(const scene of this.live.values())scene.wrap.remove();this.live.clear();this.alert.remove();}
}

/** Chromium's BGRA, premultiplied pixels as the RGBA ImageData the compositor uploads (it premultiplies on upload). */
const imageData=({width,height,data}:{width:number;height:number;data:Uint8Array})=>{
 const out=new Uint8ClampedArray(width*height*4);
 for(let i=0;i<out.length;i+=4){const a=data[i+3],k=a&&a<255?255/a:1;out[i]=data[i+2]*k;out[i+1]=data[i+1]*k;out[i+2]=data[i]*k;out[i+3]=a;}
 return new ImageData(out,width,height);
};

/** Export's scene pictures: each frame is drawn in a hidden window by the main process and returned with its
 * transparency. A scene holding a frame (or the same frame shown twice) is drawn once. */
export class SceneCaptures{
 private last=new Map<string,{frame:number;picture:ImageData}>();private documents=new Map<string,Promise<string>>();
 async picture(layer:MediaLayer,asset:Asset){
  const frame=layer.frameIndex??0,key=asset.id+':'+asset.scene!.revisionId,cached=this.last.get(key);if(cached?.frame===frame)return cached.picture;
  let source:{url:string}|{html:string};
  if(asset.scene!.format==='engine')source={url:sceneUrl(asset)};
  else{let html=this.documents.get(asset.id);if(!html){html=legacyDocument(asset);this.documents.set(asset.id,html);}source={html:await html};}
  const pixels=await window.dream.sceneFrame({key,source,width:asset.width,height:asset.height,frame,fps:asset.fps||30}).catch((error:Error)=>{throw new Error(`Scene ${asset.filename}: ${error.message.replace(/^Error invoking remote method '[^']+': (Error: )?/,'')}`);});
  const picture=imageData(pixels);this.last.set(key,{frame,picture});return picture;
 }
 close(){void window.dream.closeScenes();}
}
