import {useCurrentFrame} from 'remotion';
import {Scene3D,useTexture,resource} from '@dream/engine';

// 3D fixture: a textured cube that turns with the frame, lit by the engine's default lights.
function Cube(){
 const frame=useCurrentFrame(),texture=useTexture(resource('checker.png'));
 return <mesh rotation={[.4,frame*.05,0]}><boxGeometry args={[2.4,2.4,2.4]}/><meshStandardMaterial map={texture}/></mesh>;
}
export default function CubeScene(){return <Scene3D background="#101820"><Cube/></Scene3D>;}
