import React,{forwardRef,useLayoutEffect,useRef} from 'react';
import {Text as DreiText} from '@react-three/drei';
import {runtimeBase} from './config';
import {track} from './pending';

// Helpers that work offline and draw deterministically from the scene clock. Environment presets and other
// helpers that download files from a CDN are left out; Lightformer, RoomEnvironment and local files cover them.
export {Text3D,RoundedBox,Center,Float,Billboard,Line,QuadraticBezierLine,CubicBezierLine,Sparkles,Stars,Sky,Environment,Lightformer,ContactShadows,SoftShadows,MeshDistortMaterial,MeshWobbleMaterial,MeshTransmissionMaterial,Outlines,Edges,Grid,GradientTexture,Decal,Instances,Instance,Merged,PerspectiveCamera,OrthographicCamera,Shadow,Box,Sphere,Plane,Cylinder,Cone,Torus,TorusKnot,Circle,Ring,Capsule,Tetrahedron,Icosahedron,Dodecahedron,Octahedron,Svg,Points,Point,PointMaterial,Segments,Segment,Backdrop,Html,Clone,Image,useAnimations,CameraShake,Wireframe,Shape,Extrude,Lathe,Tube} from '@react-three/drei';

/** Text drawn with a bundled font by default, and the frame waits until its glyphs are laid out. */
export const Text=forwardRef<any,React.ComponentProps<typeof DreiText>>(function Text(props,forwarded){
 const local=useRef<any>(null);
 useLayoutEffect(()=>{const text=local.current;if(text&&(text._needsSync||text._isSyncing))track(new Promise<void>(resolve=>{text.addEventListener('synccomplete',()=>resolve(),{once:true});setTimeout(resolve,8000);}));});
 return <DreiText font={runtimeBase+'fonts/inter-latin-400-normal.woff'} {...props} ref={node=>{local.current=node;if(typeof forwarded==='function')forwarded(node);else if(forwarded)forwarded.current=node;}}/>;
});
