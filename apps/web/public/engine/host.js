/* The document an engine scene runs in, on the web (the desktop serves it from dream-engine://, main/engine-routes.ts).
 * The scene is sandboxed, so it cannot read the project's files in the browser's storage, and the service worker does
 * not serve it. It asks the editor that opened it for its scene by its own address
 * (…/engine/app/scene/<asset>/index.html or …/draft/<hash>/index.html). The answer holds the scene's configuration,
 * compiled bundle, resources and the project's media as files. Those become blob URLs here, by the paths the runtime
 * asks for (globalThis.__dreamUrls), and then the runtime chunks and the bundle load as on the desktop. For Export and
 * stills it also draws its page into a picture (modern-screenshot, from this site), since a browser page cannot paint
 * a hidden window. */
const CHUNKS=['core','three','d3','icons','noise'];
const engine=location.pathname.slice(0,location.pathname.indexOf('/engine/')+'/engine/'.length);
const post=(message,transfer=[])=>parent.postMessage({dreamScene:true,...message},'*',transfer);
const encode=path=>path.split('/').map(encodeURIComponent).join('/');
let loaded=false,capture,taker;

function load({config,version,bundle,files,media}){
 if(loaded)return;loaded=true;
 const urls={};
 for(const [name,file] of Object.entries(files))urls['files/'+encode(name)]=URL.createObjectURL(file);
 for(const [id,file] of Object.entries(media))urls['media/'+encodeURIComponent(id)]=URL.createObjectURL(file);
 globalThis.__dreamUrls=urls;
 const runtime=`${engine}runtime/${version||1}/`;
 const style=document.createElement('link');style.rel='stylesheet';style.href=runtime+'fonts.css';document.head.append(style);
 const root=document.getElementById('root');Object.assign(root.style,{position:'absolute',left:'0',top:'0',width:Math.round(config.width)+'px',height:Math.round(config.height)+'px',overflow:'hidden'});
 const element=document.createElement('script');element.type='application/json';element.id='dream-scene-config';element.textContent=JSON.stringify(config);document.head.append(element);
 // In order: the runtime, then the scene, which registers itself with it.
 const sources=[...CHUNKS.filter(chunk=>chunk==='core'||config.chunks.includes(chunk)).map(chunk=>`${runtime}${chunk}.js`),URL.createObjectURL(new Blob([bundle],{type:'text/javascript'}))];
 for(const [n,src] of sources.entries()){
  const script=document.createElement('script'),last=n===sources.length-1;script.src=src;script.async=false;
  script.onerror=()=>post({error:last?'The scene\'s code could not load.':`The scene engine could not load (${src.split('/').pop()}).`,fatal:true});
  // The runtime mounts the scene when the document has loaded (core.ts); here that is once the scene's own code has.
  if(last)script.onload=()=>document.dispatchEvent(new Event('DOMContentLoaded'));
  document.body.append(script);
 }
}

/** The page as a picture, its own size, with its transparency, sent as an ImageBitmap. */
async function picture({requestId,width,height}){
 // The picture-taker reads the browser's default styles from a helper frame it makes; inside this sandbox that frame
 // would be another origin it cannot read, so none is made and every computed style is copied instead.
 const create=document.createElement;
 try{
  capture??=import(`${engine}capture.js`);const {createContext,domToCanvas}=await capture;
  document.createElement=function(name,...rest){if(String(name).toLowerCase()==='iframe')throw new Error('No helper frames in a scene picture.');return create.call(this,name,...rest);};
  // One picture-taker for every frame of an export: its fonts, images and default styles are worked out once, not again
  // for each frame (each frame cost half a second when it started over).
  if(!taker||taker.width!==width||taker.height!==height)taker={width,height,context:await createContext(document.getElementById('root'),{width,height,scale:1,backgroundColor:null,timeout:30000,autoDestruct:false})};
  const canvas=await domToCanvas(taker.context);
  const bitmap=await createImageBitmap(canvas);post({type:'picture',requestId,bitmap},[bitmap]);
 }catch(error){post({type:'picture',requestId,error:String(error&&error.message||error)});}
 finally{document.createElement=create;}
}

addEventListener('message',event=>{
 if(event.source!==parent||!event.data?.dreamScene)return;
 if(event.data.type==='load')load(event.data);
 else if(event.data.type==='load-error')post({error:event.data.error,fatal:true});
 else if(event.data.type==='capture')void picture(event.data);
});
post({type:'need',path:location.pathname});
