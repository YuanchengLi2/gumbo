import React,{Suspense,useInsertionEffect,useLayoutEffect,useMemo,useRef,useState} from 'react';
import {createRoot,extend,useThree,type ReconcilerRoot} from '@react-three/fiber';
import {FiberProvider,useContextBridge} from 'its-fine';
import {Internals,useVideoConfig} from 'remotion';
import * as THREE from 'three';
import {RoomEnvironment} from 'three/examples/jsm/environments/RoomEnvironment.js';
import {track,changed,suspendedResource} from '../pending';

/** Image-based lighting from a procedural studio room, so physically based materials look right with no setup. */
function StudioEnvironment(){
 const {gl,scene}=useThree();
 useLayoutEffect(()=>{const pmrem=new THREE.PMREMGenerator(gl),texture=pmrem.fromScene(new RoomEnvironment(),.04).texture;const previous=scene.environment;scene.environment=texture;return()=>{scene.environment=previous;texture.dispose();pmrem.dispose();};},[gl,scene]);
 return null;
}
// 3D trees commit on their own schedule (including when suspended textures arrive); each commit asks for a redraw.
function Committed(){useLayoutEffect(()=>{changed();});return null;}
const webgl=()=>{try{const canvas=document.createElement('canvas');return !!(canvas.getContext('webgl2')??canvas.getContext('webgl'));}catch{return false;}};

type Scene3DProps={children?:React.ReactNode;camera?:Record<string,unknown>;background?:string;lights?:boolean;environment?:boolean;shadows?:boolean;orthographic?:boolean;style?:React.CSSProperties;gl?:Record<string,unknown>};
/** Draws whatever the frame's tree threw (a texture error, a bad prop) as the scene's error instead of a blank canvas. */
class Boundary extends React.Component<{onError:(error:Error)=>void;children?:React.ReactNode},{failed:boolean}>{state={failed:false};static getDerivedStateFromError(){return{failed:true};}componentDidCatch(error:Error){this.props.onError(error);}render(){return this.state.failed?null:this.props.children;}}

/** A background colour for the 3D canvas, or none (see-through, so the scene behind it shows). Colours three.js cannot
 * read would silently become white, so they are reported as errors instead. */
export function canvasBackground(value?:string){
 if(!value||/^(transparent|none)$/i.test(value.trim()))return undefined;
 const color=new THREE.Color(),original=console.warn;let unknown=false;console.warn=()=>{unknown=true;};try{color.setStyle(value);}finally{console.warn=original;}
 if(unknown)throw new Error(`Scene3D background "${value}" is not a colour. Use a CSS colour such as "#0b1e3a", or leave it out for a see-through canvas.`);
 return value;
}
function Scene3DRoot({children,camera,background,lights=true,environment=true,shadows=false,orthographic=false,style,gl}:Scene3DProps){
 const canvasColor=canvasBackground(background);
 const {width,height}=useVideoConfig(),contexts=Internals.useRemotionContexts(),Bridge=useContextBridge();
 const canvas=useRef<HTMLCanvasElement>(null),root=useRef<ReconcilerRoot<HTMLCanvasElement>|null>(null),configured=useRef('');
 const [error,setError]=useState<Error|null>(null);if(error)throw error;
 if(!useMemo(webgl,[]))throw new Error('WebGL is unavailable in this environment, so the 3D scene cannot be drawn.');
 useMemo(()=>extend(THREE as any),[]);
 useInsertionEffect(()=>()=>{root.current?.unmount();root.current=null;},[]);
 useLayoutEffect(()=>{
  root.current??=createRoot(canvas.current!);const current=root.current;
  const options={gl:{preserveDrawingBuffer:true,antialias:true,...gl},frameloop:'never' as const,dpr:1,shadows,orthographic,events:undefined,size:{width,height,top:0,left:0},camera:camera??(orthographic?{position:[0,0,10],zoom:100}:{position:[4,3,6],fov:45}),onCreated:(state:any)=>{if(!camera?.rotation&&!camera?.quaternion)state.camera.lookAt(0,0,0);}};
  // Configured once (and again only if size or camera settings change), so animated cameras are never reset.
  const key=JSON.stringify([width,height,camera,shadows,orthographic,gl]),configure=configured.current===key?Promise.resolve():current.configure(options as any).then(()=>{configured.current=key;});
  track(configure.then(()=>{current.render(<Bridge><Internals.RemotionContextProvider contexts={contexts}><Boundary onError={setError}>
   {canvasColor&&<color attach="background" args={[canvasColor]}/>}
   {lights&&<><ambientLight intensity={.35}/><directionalLight position={[5,8,6]} intensity={1.6} castShadow={shadows}/><directionalLight position={[-6,3,-4]} intensity={.5}/></>}
   {environment&&<StudioEnvironment/>}
   <Suspense fallback={null}><Committed/>{children}</Suspense>
  </Boundary></Internals.RemotionContextProvider></Bridge>);}).catch(setError));
 });
 return <canvas ref={canvas} width={width} height={height} style={{width,height,display:'block',...style}}/>;
}
/** A 3D canvas sized to the scene that draws exactly the current frame. It comes with a camera aimed at the origin,
 * key and fill lights and studio reflections; pass lights={false} or environment={false} to light it yourself. */
export function Scene3D(props:Scene3DProps){return <FiberProvider><Scene3DRoot {...props}/></FiberProvider>;}

type TextureOptions={filter?:'nearest'|'linear';repeat?:[number,number]};
const textures=new Map<string,{texture?:THREE.Texture;error?:Error;promise:Promise<void>;committed?:()=>void}>();
/** Loads an image as a texture (suspends until it is ready, so the frame waits for it). filter 'nearest' keeps hard
 * pixel edges when magnified; repeat tiles the image. */
export function useTexture(src:string,options:TextureOptions={}){
 const key=JSON.stringify([src,options.filter??'linear',options.repeat??null]);let entry=textures.get(key);
 if(!entry){
  const created:{texture?:THREE.Texture;error?:Error;promise:Promise<void>;committed?:()=>void}={promise:Promise.resolve()};
  created.promise=track(new Promise<THREE.Texture>((resolve,reject)=>new THREE.TextureLoader().load(src,resolve,undefined,()=>reject(new Error(`The texture ${src} could not be loaded.`)))).then(texture=>{
   texture.colorSpace=THREE.SRGBColorSpace;
   if(options.filter==='nearest'){texture.magFilter=THREE.NearestFilter;texture.minFilter=THREE.NearestFilter;texture.generateMipmaps=false;}
   if(options.repeat){texture.wrapS=texture.wrapT=THREE.RepeatWrapping;texture.repeat.set(...options.repeat);}
   texture.needsUpdate=true;created.texture=texture;
  },error=>{created.error=error;}));
  created.committed=suspendedResource(created.promise);textures.set(key,created);entry=created;
 }
 if(entry.error)throw entry.error;if(!entry.texture)throw entry.promise;
 const ready=entry;useLayoutEffect(()=>{ready.committed?.();},[ready]);
 return entry.texture;
}
