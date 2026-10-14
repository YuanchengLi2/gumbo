import * as THREE from 'three';
import * as Fiber from '@react-three/fiber';
import * as Drei from '../drei-subset';
import * as RemotionThree from '@remotion/three';
import * as Engine3D from '../api/three';
import * as RoundedBoxGeometry from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as TextGeometry from 'three/addons/geometries/TextGeometry.js';
import * as ConvexGeometry from 'three/addons/geometries/ConvexGeometry.js';
import * as ParametricGeometry from 'three/addons/geometries/ParametricGeometry.js';
import * as FontLoader from 'three/addons/loaders/FontLoader.js';
import * as SVGLoader from 'three/addons/loaders/SVGLoader.js';
import * as GLTFLoader from 'three/addons/loaders/GLTFLoader.js';
import * as ImprovedNoise from 'three/addons/math/ImprovedNoise.js';
import * as SimplexNoise from 'three/addons/math/SimplexNoise.js';
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import * as RoomEnvironment from 'three/addons/environments/RoomEnvironment.js';
import * as Line2 from 'three/addons/lines/Line2.js';
import * as LineMaterial from 'three/addons/lines/LineMaterial.js';
import * as LineGeometry from 'three/addons/lines/LineGeometry.js';
import * as Sky from 'three/addons/objects/Sky.js';

const registry=(globalThis as any).DreamEngine;
const addons:Record<string,unknown>={'geometries/RoundedBoxGeometry.js':RoundedBoxGeometry,'geometries/TextGeometry.js':TextGeometry,'geometries/ConvexGeometry.js':ConvexGeometry,'geometries/ParametricGeometry.js':ParametricGeometry,'loaders/FontLoader.js':FontLoader,'loaders/SVGLoader.js':SVGLoader,'loaders/GLTFLoader.js':GLTFLoader,'math/ImprovedNoise.js':ImprovedNoise,'math/SimplexNoise.js':SimplexNoise,'utils/BufferGeometryUtils.js':BufferGeometryUtils,'utils/SkeletonUtils.js':SkeletonUtils,'environments/RoomEnvironment.js':RoomEnvironment,'lines/Line2.js':Line2,'lines/LineMaterial.js':LineMaterial,'lines/LineGeometry.js':LineGeometry,'objects/Sky.js':Sky};
const modules:Record<string,unknown>={'three':THREE,'@react-three/fiber':Fiber,'@react-three/drei':Drei,'@remotion/three':RemotionThree,'@dream/engine/three':Engine3D,...Object.fromEntries(Object.entries(addons).map(([path,value])=>['three/addons/'+path,value]))};
for(const [name,value] of Object.entries(modules))registry.define(name,()=>value);
// Every 3D root renders on demand only: each requested frame advances all of them to exactly that time.
registry.frameHooks.push((seconds:number)=>Fiber.advance(seconds));
