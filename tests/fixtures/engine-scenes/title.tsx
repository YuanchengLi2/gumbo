import {AbsoluteFill,Sequence,spring,useCurrentFrame,useVideoConfig,interpolate,Img} from 'remotion';
import {FitText,SafeArea,asset} from '@dream/engine';

// 2D fixture: a sliding red panel (position driven by the frame), a spring-scaled title and an imported image.
export default function Title(){
 const frame=useCurrentFrame(),{fps,width}=useVideoConfig();
 const scale=spring({frame,fps,config:{damping:200}});
 return <AbsoluteFill style={{background:'#0000ff'}}>
  <div data-testid="panel" style={{position:'absolute',top:0,left:interpolate(frame,[0,29],[0,width-100],{extrapolateRight:'clamp'}),width:100,height:100,background:'#ff0000'}}/>
  <Sequence from={10}><Img src={asset('fixture-image')} style={{position:'absolute',right:0,bottom:0,width:120,height:120}}/></Sequence>
  <SafeArea style={{justifyContent:'center'}}><div style={{height:200,transform:`scale(${scale})`}}><FitText fontFamily="Bebas Neue" style={{color:'#fff'}}>Dream engine title that has to fit</FitText></div></SafeArea>
 </AbsoluteFill>;
}
