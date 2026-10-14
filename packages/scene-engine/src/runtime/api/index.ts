import React from 'react';
export {asset,useAsset,resource,staticFile,useText,useJson} from './files';
export {SourceVideo} from './media';
export {FitText,SafeArea,fonts,loadFont} from './layout';
export {useBeats} from './beats';

// 3D helpers live in the three chunk; these forwarders let scenes import everything from '@dream/engine'.
// The compiler loads the three chunk for any scene that names them.
const three=()=>(globalThis as any).DreamEngine.require('@dream/engine/three');
export function Scene3D(props:Record<string,unknown>){return React.createElement(three().Scene3D,props);}
export function useTexture(src:string,options?:{filter?:'nearest'|'linear';repeat?:[number,number]}){return three().useTexture(src,options);}
