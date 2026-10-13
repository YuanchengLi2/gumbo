// Runs in Electron's Chromium: draws test frames with the compositor and reports pixels, for tests/gl/compositor.test.ts.
import {Compositor,type Frame} from '../../packages/compositor/src/index';
const pixel=(gl:WebGL2RenderingContext,x:number,y:number)=>{const out=new Uint8Array(4);gl.readPixels(x,gl.drawingBufferHeight-1-y,1,1,gl.RGBA,gl.UNSIGNED_BYTE,out);return Array.from(out.slice(0,3));};
(window as any).runCase=async(name:string)=>{
 const canvas=document.createElement('canvas');canvas.width=200;canvas.height=100;const c=new Compositor(canvas);const gl=(c as any).gl as WebGL2RenderingContext;
 // A picture whose left half is red and right half blue.
 const pic=new OffscreenCanvas(40,20),p=pic.getContext('2d')!;p.fillStyle='#ff0000';p.fillRect(0,0,20,20);p.fillStyle='#0000ff';p.fillRect(20,0,20,20);
 const media=(o:object={})=>({kind:'media',assetId:'a',media:'image',time:0,uv:{x:0,y:0,w:1,h:1},rect:{x:0,y:0,w:200,h:100},transform:[1,0,0,1,0,0],opacity:1,grades:[],blur:0,...o});
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
 };
 c.draw(frames[name],()=>pic);
 return{left:pixel(gl,20,50),right:pixel(gl,180,50),middleLeft:pixel(gl,95,50),middleRight:pixel(gl,105,50),corner:pixel(gl,2,2),centre:pixel(gl,100,50),edge:pixel(gl,60,50)};
};
(window as any).ready=true;
