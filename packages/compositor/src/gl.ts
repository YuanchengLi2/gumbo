import type {Frame,MediaLayer,Matrix,Rect,Grade,TextLayer} from './frame';
import {paintText} from './paint';

/** Anything a browser can upload as a texture: a playing video element, a decoded VideoFrame, an image or a canvas. */
export type Picture=TexImageSource;
/** Supplies the picture for a media layer: the video at layer.time, the image, or the sequence frame. Undefined skips it. */
export type PictureSource=(layer:MediaLayer)=>Picture|undefined;

const VERTEX=`#version 300 es
in vec2 corner;uniform vec4 rect;uniform mat3 matrix;uniform vec2 view;uniform vec4 uv;out vec2 v_uv;
void main(){vec2 p=rect.xy+corner*rect.zw;vec3 q=matrix*vec3(p,1.0);vec2 ndc=q.xy/view*2.0-1.0;gl_Position=vec4(ndc.x,-ndc.y,0.0,1.0);v_uv=uv.xy+corner*uv.zw;}`;
/** The grade is CSS's filters in order, in sRGB as the player applied them: brightness 2^exposure, contrast about mid
 * grey, saturate with its luminance weights, then the white-balance colour matrix. Blur averages a 7x7 grid weighted as a
 * Gaussian whose deviation is the CSS blur radius. */
const FRAGMENT=`#version 300 es
precision highp float;in vec2 v_uv;uniform sampler2D picture;uniform float opacity;uniform int grades;uniform vec4 grade[4];uniform float blur;uniform vec2 texel;uniform vec4 fill;uniform bool solid;out vec4 colour;
vec3 graded(vec3 c,vec4 g){c*=exp2(g.x);c=(c-0.5)*g.y+0.5;float s=g.z;mat3 m=mat3(0.213+0.787*s,0.213-0.213*s,0.213-0.213*s,0.715-0.715*s,0.715+0.285*s,0.715-0.715*s,0.072-0.072*s,0.072-0.072*s,0.072+0.928*s);c=clamp(m*clamp(c,0.0,1.0),0.0,1.0);float k=clamp(g.w,-1.0,1.0);return clamp(c*vec3(1.0+0.25*k,1.0+0.04*k,1.0-0.25*k),0.0,1.0);}
void main(){if(solid){colour=vec4(fill.rgb*fill.a*opacity,fill.a*opacity);return;}
 vec4 c;if(blur>0.0){vec4 sum=vec4(0.0);float total=0.0;for(int i=-3;i<=3;i++)for(int j=-3;j<=3;j++){vec2 o=vec2(float(i),float(j))*blur/1.5;float w=exp(-dot(o,o)/(2.0*blur*blur));sum+=texture(picture,clamp(v_uv+o*texel,0.0,1.0))*w;total+=w;}c=sum/total;}else c=texture(picture,v_uv);
 vec3 rgb=c.a>0.0?c.rgb/c.a:c.rgb;for(int i=0;i<4;i++){if(i>=grades)break;rgb=graded(rgb,grade[i]);}
 colour=vec4(rgb*c.a*opacity,c.a*opacity);}`;

const parseColour=(css:string):[number,number,number,number]=>{
 const hex=/^#([0-9a-f]{3,8})$/i.exec(css.trim());if(hex){let h=hex[1];if(h.length<=4)h=h.split('').map(c=>c+c).join('');const n=(i:number)=>parseInt(h.slice(i,i+2),16)/255;return[n(0),n(2),n(4),h.length===8?n(6):1];}
 const rgb=/^rgba?\(([^)]+)\)$/i.exec(css.trim());if(rgb){const v=rgb[1].split(/[ ,/]+/).filter(Boolean).map(Number);return[v[0]/255,v[1]/255,v[2]/255,v[3]??1];}
 return[0,0,0,1];
};

/** Draws frames on a canvas with WebGL2: the same layers in the player and in Export, so they show the same picture. The
 * canvas may be any size; the frame is scaled to it. */
export class Compositor{
 private gl:WebGL2RenderingContext;private program:WebGLProgram;private quad:WebGLVertexArrayObject;private textures=new Map<string,{texture:WebGLTexture;picture?:Picture;width:number;height:number}>();
 private text:OffscreenCanvas;private textContext:OffscreenCanvasRenderingContext2D;private u:Record<string,WebGLUniformLocation|null>={};
 constructor(readonly canvas:HTMLCanvasElement|OffscreenCanvas){
  const gl=canvas.getContext('webgl2',{alpha:false,antialias:true,premultipliedAlpha:true,preserveDrawingBuffer:true}) as WebGL2RenderingContext|null;if(!gl)throw new Error('This computer cannot draw the video with its graphics card (WebGL2 is unavailable).');this.gl=gl;
  const shader=(type:number,source:string)=>{const s=gl.createShader(type)!;gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error('Shader: '+gl.getShaderInfoLog(s));return s;};
  const program=gl.createProgram()!;gl.attachShader(program,shader(gl.VERTEX_SHADER,VERTEX));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,FRAGMENT));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error('Program: '+gl.getProgramInfoLog(program));this.program=program;
  for(const name of ['rect','matrix','view','uv','picture','opacity','grades','grade','blur','texel','fill','solid'])this.u[name]=gl.getUniformLocation(program,name);
  this.quad=gl.createVertexArray()!;gl.bindVertexArray(this.quad);const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([0,0,1,0,0,1,1,1]),gl.STATIC_DRAW);
  const corner=gl.getAttribLocation(program,'corner');gl.enableVertexAttribArray(corner);gl.vertexAttribPointer(corner,2,gl.FLOAT,false,0,0);
  this.text=new OffscreenCanvas(1,1);this.textContext=this.text.getContext('2d')!;
 }
 private texture(key:string,picture:Picture,static_=false){
  const gl=this.gl;let entry=this.textures.get(key);
  if(!entry){const texture=gl.createTexture()!;gl.bindTexture(gl.TEXTURE_2D,texture);for(const [p,v] of [[gl.TEXTURE_MIN_FILTER,gl.LINEAR],[gl.TEXTURE_MAG_FILTER,gl.LINEAR],[gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE],[gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE]])gl.texParameteri(gl.TEXTURE_2D,p,v);entry={texture,width:0,height:0};this.textures.set(key,entry);}
  gl.bindTexture(gl.TEXTURE_2D,entry.texture);
  if(!static_||entry.picture!==picture){gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,picture);entry.picture=picture;
   const size=picture as {videoWidth?:number;displayWidth?:number;width?:number;videoHeight?:number;displayHeight?:number;height?:number};entry.width=size.videoWidth||size.displayWidth||size.width||1;entry.height=size.videoHeight||size.displayHeight||size.height||1;}
  return entry;
 }
 private quadDraw(rect:Rect,matrix:Matrix,uv:Rect,opacity:number,frame:Frame,o:{fill?:[number,number,number,number];grades?:Grade[];blur?:number;texel?:[number,number]}={}){
  const gl=this.gl,u=this.u;gl.uniform4f(u.rect,rect.x,rect.y,rect.w,rect.h);gl.uniformMatrix3fv(u.matrix,false,[matrix[0],matrix[1],0,matrix[2],matrix[3],0,matrix[4],matrix[5],1]);gl.uniform2f(u.view,frame.width,frame.height);gl.uniform4f(u.uv,uv.x,uv.y,uv.w,uv.h);gl.uniform1f(u.opacity,opacity);
  gl.uniform1i(u.solid,o.fill?1:0);if(o.fill)gl.uniform4f(u.fill,...o.fill);
  const grades=(o.grades??[]).slice(0,4);gl.uniform1i(u.grades,grades.length);if(grades.length)gl.uniform4fv(u.grade,grades.flatMap(g=>[g.exposure,g.contrast,g.saturation,g.temperature]).concat(Array(16-grades.length*4).fill(0)));
  gl.uniform1f(u.blur,o.blur??0);gl.uniform2f(u.texel,...(o.texel??[0,0]));gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
 }
 /** Draws a frame. Layers whose picture is not available yet are skipped (the player shows the last picture it had). */
 draw(frame:Frame,source:PictureSource){
  const gl=this.gl,width=this.canvas.width,height=this.canvas.height,scale=width/frame.width;
  gl.viewport(0,0,width,height);gl.useProgram(this.program);gl.bindVertexArray(this.quad);gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
  const [r,g,b]=parseColour(frame.background);gl.clearColor(r,g,b,1);gl.clear(gl.COLOR_BUFFER_BIT);gl.activeTexture(gl.TEXTURE0);gl.uniform1i(this.u.picture,0);
  const full={x:0,y:0,w:frame.width,h:frame.height},none:Matrix=[1,0,0,1,0,0];
  for(let n=0;n<frame.layers.length;n++){const layer=frame.layers[n];
   if(layer.kind==='fill'){if(layer.opacity>0)this.quadDraw(layer.rect,layer.transform,{x:0,y:0,w:1,h:1},layer.opacity,frame,{fill:parseColour(layer.color)});continue;}
   if(layer.kind==='media'){if(layer.opacity<=0||!layer.rect.w||!layer.rect.h)continue;const picture=source(layer);if(!picture)continue;
    this.texture(layer.media==='video'?'video:'+layer.assetId+':'+n:'still:'+layer.assetId+':'+(layer.frameIndex??0),picture,layer.media!=='video');
    this.quadDraw(layer.rect,layer.transform,layer.uv,layer.opacity,frame,{grades:layer.grades,blur:layer.blur,texel:[layer.uv.w/layer.rect.w,layer.uv.h/layer.rect.h]});continue;}
   // Consecutive text layers are painted together on one canvas the size of the output, then drawn over the frame.
   const run:TextLayer[]=[];while(n<frame.layers.length&&frame.layers[n].kind==='text')run.push(frame.layers[n++] as TextLayer);n--;
   if(this.text.width!==width||this.text.height!==height){this.text.width=width;this.text.height=height;}
   this.textContext.clearRect(0,0,width,height);for(const t of run)paintText(this.textContext,t,frame.width,frame.height,scale);
   this.texture('text',this.text);this.quadDraw(full,none,{x:0,y:0,w:1,h:1},1,frame);
  }
 }
 dispose(){for(const {texture} of this.textures.values())this.gl.deleteTexture(texture);this.textures.clear();this.gl.deleteProgram(this.program);}
}
