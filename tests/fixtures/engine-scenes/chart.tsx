import {AbsoluteFill,useCurrentFrame,useVideoConfig,interpolate} from 'remotion';
import {scaleBand,scaleLinear} from 'd3';

// d3 fixture: bars grow from zero over the first second.
const data=[4,8,15,16,23,42];
export default function Chart(){
 const frame=useCurrentFrame(),{width,height}=useVideoConfig(),grow=interpolate(frame,[0,30],[0,1],{extrapolateRight:'clamp'});
 const x=scaleBand<number>().domain(data.map((_,i)=>i)).range([40,width-40]).padding(.2),y=scaleLinear().domain([0,42]).range([0,height-80]);
 return <AbsoluteFill style={{background:'#ffffff'}}><svg width={width} height={height}>{data.map((d,i)=><rect key={i} x={x(i)} width={x.bandwidth()} y={height-40-y(d)*grow} height={y(d)*grow} fill="#00a000"/>)}</svg></AbsoluteFill>;
}
