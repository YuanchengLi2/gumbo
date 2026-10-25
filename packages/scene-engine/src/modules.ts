/** Which prebuilt runtime chunk provides each import a scene may use. The compiler, the runtime build and the
 * tests all read this one table: a scene import not listed here is an error naming what is available. */
export type Chunk='core'|'three'|'d3'|'icons'|'noise';
export const CHUNKS:readonly Chunk[]=['core','three','d3','icons','noise'];

const threeAddons=['geometries/RoundedBoxGeometry.js','geometries/TextGeometry.js','geometries/ConvexGeometry.js','geometries/ParametricGeometry.js','loaders/FontLoader.js','loaders/SVGLoader.js','loaders/GLTFLoader.js','math/ImprovedNoise.js','math/SimplexNoise.js','utils/BufferGeometryUtils.js','utils/SkeletonUtils.js','environments/RoomEnvironment.js','lines/Line2.js','lines/LineMaterial.js','lines/LineGeometry.js','objects/Sky.js'];
export const THREE_ADDONS:readonly string[]=threeAddons.map(path=>'three/addons/'+path);
const d3Modules=['d3-array','d3-scale','d3-shape','d3-interpolate','d3-ease','d3-color','d3-format','d3-time','d3-time-format','d3-geo','d3-hierarchy','d3-random','d3-delaunay','d3-force','d3-path','d3-scale-chromatic','d3-timer','d3-chord','d3-contour','d3-polygon','d3-quadtree'];
export const REMOTION_TRANSITIONS:readonly string[]=['','/fade','/slide','/wipe','/flip','/clock-wipe','/none','/iris','/zoom-in-out','/push-cut','/swap'].map(path=>'@remotion/transitions'+path);

export const MODULES:Readonly<Record<string,Chunk>>={
 'react':'core','react/jsx-runtime':'core','react/jsx-dev-runtime':'core','react-dom':'core',
 'remotion':'core','@remotion/shapes':'core','@remotion/paths':'core','@remotion/layout-utils':'core',...Object.fromEntries(REMOTION_TRANSITIONS.map(name=>[name,'core' as const])),
 '@dream/engine':'core',
 'three':'three','@react-three/fiber':'three','@react-three/drei':'three','@remotion/three':'three','@dream/engine/three':'three',...Object.fromEntries(THREE_ADDONS.map(name=>[name,'three' as const])),
 'd3':'d3',...Object.fromEntries(d3Modules.map(name=>[name,'d3' as const])),
 'lucide-react':'icons',
 'simplex-noise':'noise','@remotion/noise':'noise',
};

/** Spellings that mean the same module: three's examples path, missing .js on addons, and the classic JSX runtime. */
export function moduleName(specifier:string):string{
 let name=specifier.replace(/^three\/examples\/jsm\//,'three/addons/');
 if(name.startsWith('three/addons/')&&!name.endsWith('.js'))name+='.js';
 if(name==='react/jsx-dev-runtime')return'react/jsx-runtime';
 return name;
}
export const chunkOf=(specifier:string):Chunk|undefined=>MODULES[moduleName(specifier)];

/** Engine helpers implemented in the three chunk. A scene that names them through @dream/engine needs that chunk. */
export const THREE_HELPERS=['Scene3D','useTexture'] as const;

/** The chunks a scene needs, in load order (core first). */
export function chunksFor(imports:Iterable<string>,usesThreeHelpers=false):Chunk[]{
 const needed=new Set<Chunk>(['core']);for(const name of imports){const chunk=chunkOf(name.replace(/^dream-module:/,''));if(chunk)needed.add(chunk);}
 if(usesThreeHelpers)needed.add('three');
 return CHUNKS.filter(chunk=>needed.has(chunk));
}
export function unknownModuleMessage(specifier:string){
 const families=['react','remotion','@remotion/shapes','@remotion/paths','@remotion/transitions','@remotion/layout-utils','@remotion/noise','@remotion/three','three (and three/addons/…)','@react-three/fiber','@react-three/drei','d3 (and d3-*)','lucide-react','simplex-noise','@dream/engine'];
 const pkg=specifier.startsWith('@')?specifier.split('/').slice(0,2).join('/'):specifier.split('/')[0];
 return `"${specifier}" is not installed. Install it with run (npm install ${pkg}); installed packages are bundled into the scene automatically. Already provided without installing: ${families.join(', ')}.`;
}
