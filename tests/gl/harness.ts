// Runs in Electron's Chromium: draws test frames with the compositor and reports pixels, for tests/gl/compositor.test.ts.
import {Compositor,type Frame} from '../../packages/compositor/src/index';
const pixel=(gl:WebGL2RenderingContext,x:number,y:number)=>{const out=new Uint8Array(4);gl.readPixels(x,gl.drawingBufferHeight-1-y,1,1,gl.RGBA,gl.UNSIGNED_BYTE,out);return Array.from(out.slice(0,3));};
(window as any).runCase=async(name:string)=>{
 const canvas=document.createElement('canvas');canvas.width=200;canvas.height=100;const c=new Compositor(canvas);const gl=(c as any).gl as WebGL2RenderingContext;
 // A picture whose left half is red and right half blue.
 const pic=new OffscreenCanvas(40,20),p=pic.getContext('2d')!;p.fillStyle='#ff0000';p.fillRect(0,0,20,20);p.fillStyle='#0000ff';p.fillRect(20,0,20,20);
 const media=(o:object={})=>({kind:'media',key:'a',assetId:'a',media:'image',time:0,rate:1,uv:{x:0,y:0,w:1,h:1},rect:{x:0,y:0,w:200,h:100},transform:[1,0,0,1,0,0],opacity:1,grades:[],blur:0,...o});
 const frames:Record<string,Frame>={
  plain:{width:200,height:100,background:'#000000',layers:[media() as any]},
  // Scaled 2x about the centre: the red/blue boundary stays mid-frame and the edges are deep in each half.
  zoom:{width:200,height:100,background:'#000000',layers:[media({transform:[2,0,0,2,-100,-50]}) as any]},
  // Moved right by 50 px and half transparent over white.
  moved:{width:200,height:100,background:'#ffffff',layers:[media({transform:[1,0,0,1,50,0],opacity:.5}) as any]},
  graded:{width:200,height:100,background:'#000000',layers:[media({grades:[{exposure:-1,contrast:1,saturation:1,temperature:0}]}) as any]},
  grey:{width:200,height:100,background:'#000000',layers:[media({grades:[{exposure:0,contrast:1,saturation:0,temperature:0}]}) as any]},
  // Twice the frame's size drawn at half: the canvas is 200x100, the frame 400x200.
  scaled:{width:400,height:200,background:'#000000',layers:[media({rect:{x:0,y:0,w:400,h:200}}) as any]},
  text:{width:200,height:100,background:'#000000',layers:[{kind:'text',key:'t',component:'lower_third',text:'Hi',x:.5,y:.5,rotation:0,scale:1,opacity:1,color:'#ffffff',background:'#00ff00',fontSize:20,fontWeight:500} as any]},
  // Wipes and reveals: only the mask's rectangle or circle of the layer is drawn.
  maskRect:{width:200,height:100,background:'#000000',layers:[media({mask:{kind:'rect',rect:{x:100,y:0,w:100,h:100}}}) as any]},
  maskCircle:{width:200,height:100,background:'#000000',layers:[media({mask:{kind:'circle',cx:100,cy:50,r:20}}) as any]},
  // Filters: a 120° hue turn takes red to green; a full fade lifts the blacks and dims the whites.
  hue:{width:200,height:100,background:'#000000',layers:[media({grades:[{exposure:0,contrast:1,saturation:1,temperature:0,hue:120}]}) as any]},
  fade:{width:200,height:100,background:'#000000',layers:[media({grades:[{exposure:0,contrast:1,saturation:1,temperature:0,fade:1}]}) as any]},
  // Effects: the channels pulled 30 px apart near the red/blue edge, a vignette, and 80 px blocks.
  split:{width:200,height:100,background:'#000000',layers:[media({fx:{split:30}}) as any]},
  vignette:{width:200,height:100,background:'#000000',layers:[media({fx:{vignette:1}}) as any]},
  pixel:{width:200,height:100,background:'#000000',layers:[media({fx:{pixel:80}}) as any]},
  // A heart sticker drawn at the centre, and a magenta tint on a darkened picture.
  sticker:{width:200,height:100,background:'#000000',layers:[{kind:'text',key:'s',component:'sticker',sticker:'heart',text:'',x:.5,y:.5,rotation:0,scale:1,opacity:1,color:'#ff0000',background:'#ffffff',fontSize:0,fontWeight:0,size:80,time:0} as any]},
  tint:{width:200,height:100,background:'#000000',layers:[media({grades:[{exposure:-1,contrast:1,saturation:1,temperature:0,tint:1}]}) as any]},
  // Transition masks: the right side of an edge at x = 100, a clock hand swept half way round (the right half), stripes
  // 50 px apart open by half.
  maskEdge:{width:200,height:100,background:'#000000',layers:[media({mask:{kind:'edge',nx:1,ny:0,d:100,feather:0}}) as any]},
  maskClock:{width:200,height:100,background:'#000000',layers:[media({mask:{kind:'clock',cx:100,cy:50,sweep:Math.PI}}) as any]},
  stripes:{width:200,height:100,background:'#000000',layers:[media({mask:{kind:'stripes',period:50,open:.5,vertical:true}}) as any]},
  // A full film burn whites the picture out; a light leak lights the blue half warm; a 60 px streak across the red/blue
  // edge mixes them; a zoom blur on the picture moved 30 px right pulls red into the blue just past its edge.
  burn:{width:200,height:100,background:'#000000',layers:[media({fx:{burn:1,phase:0,variant:0}}) as any]},
  leak:{width:200,height:100,background:'#000000',layers:[media({fx:{leak:1,phase:.5,variant:2}}) as any]},
  streak:{width:200,height:100,background:'#000000',layers:[media({fx:{streakX:60}}) as any]},
  zoomBlur:{width:200,height:100,background:'#000000',layers:[media({transform:[1,0,0,1,30,0],fx:{zoomBlur:1}}) as any]},
  // A lower third: left-aligned from x = 20 with a red accent bar flush at the green box's left edge and a second line;
  // a caption whose second word sits on a blue word box.
  lowerThird:{width:200,height:100,background:'#000000',probes:[[10,50],[22,50],[60,50]],layers:[{kind:'text',key:'l',component:'text',text:'Hi',subtext:'there',align:'left',accent:'#ff0000',x:.1,y:.5,rotation:0,scale:1,opacity:1,color:'#ffffff',background:'#00ff00',padding:6,fontSize:20,fontWeight:500} as any]} as any,
  wordBox:{width:200,height:100,background:'#000000',probes:[[73,40],[126,40]],layers:[{kind:'text',key:'c',component:'caption',text:'aa bb',words:[{text:'aa',highlight:false},{text:'bb',highlight:true}],wordBox:'#0000ff',x:.5,y:.5,rotation:0,scale:1,opacity:1,color:'#ffffff',background:'transparent',fontSize:20,fontWeight:600} as any]} as any,
 };
 c.draw(frames[name],()=>pic);
 return{left:pixel(gl,20,50),right:pixel(gl,180,50),middleLeft:pixel(gl,95,50),middleRight:pixel(gl,105,50),corner:pixel(gl,2,2),centre:pixel(gl,100,50),edge:pixel(gl,60,50),at140:pixel(gl,140,50),probes:((frames[name] as any).probes??[]).map(([x,y]:number[])=>pixel(gl,x,y))};
};
(window as any).ready=true;
