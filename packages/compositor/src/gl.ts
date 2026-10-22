import type {Frame,MediaLayer,Matrix,Rect,Grade,TextLayer,Mask,Fx} from './frame';
import {paintText} from './paint';

/** Pixels as Chromium paints them, blue first and premultiplied: a scene's frame from its window. They are uploaded as
 * they are and read in the shader's order, so no pass over the pixels on the processor converts them. */
export type RawPicture={width:number;height:number;data:Uint8Array;format:'bgra-premultiplied'};
/** Anything a browser can upload as a texture (a playing video element, a decoded VideoFrame, an image or a canvas), or
 * raw pixels. */
export type Picture=TexImageSource|RawPicture;
const isRaw=(picture:Picture):picture is RawPicture=>(picture as RawPicture).format==='bgra-premultiplied';
/** Supplies the picture for a media layer: the video at layer.time, the image, or the sequence frame. Undefined skips it. */
export type PictureSource=(layer:MediaLayer)=>Picture|undefined;

const VERTEX=`#version 300 es
in vec2 corner;uniform vec4 rect;uniform mat3 matrix;uniform vec2 view;uniform vec4 uv;out vec2 v_uv;
void main(){vec2 p=rect.xy+corner*rect.zw;vec3 q=matrix*vec3(p,1.0);vec2 ndc=q.xy/view*2.0-1.0;gl_Position=vec4(ndc.x,-ndc.y,0.0,1.0);v_uv=uv.xy+corner*uv.zw;}`;
/** The grade is CSS's filters in order, in sRGB as the player applied them: brightness 2^exposure, contrast about mid
 * grey, saturate with its luminance weights, hue-rotate, then the white-balance colour matrix; Gumbo's filters add a
 * green-magenta tint, a teal-and-orange split tone and a fade that lifts the blacks. Blur averages a 7x7 grid weighted as
 * a Gaussian whose deviation is the CSS blur radius. Effects work on the frame's own pixels (so the preview and Export,
 * drawn at different sizes, look the same): bands shifted sideways, blocks, the colour channels pulled apart, a glow from
 * the bright parts, a vignette, scan lines and grain; a motion blur along a streak and a radial zoom blur toward the middle;
 * a film burn (noise eating in from a corner, orange to white) and a light leak (warm blobs drifting across), both screened
 * over the picture and moved by a phase in seconds, so they flow rather than flicker. A mask keeps a rectangle, a circle,
 * one side of an edge (hard or feathered), a clock hand's sweep or stripes of the layer (wipes and reveals). */
const FRAGMENT=`#version 300 es
precision highp float;in vec2 v_uv;uniform sampler2D picture;uniform float opacity;uniform int grades;uniform vec4 grade[8];uniform float blur;uniform vec2 texel;uniform vec4 fill;uniform bool solid;uniform bool bgra;
uniform vec2 canvas;uniform float frameScale;uniform vec2 frameSize;uniform int maskKind;uniform vec4 maskRect;uniform vec3 maskCircle;uniform vec4 fxA;uniform vec4 fxB;uniform vec4 fxC;uniform vec4 fxD;out vec4 colour;
vec2 fp;
float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float vnoise(vec2 p){vec2 i=floor(p),f=fract(p);f=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1.0,0.0)),f.x),mix(hash(i+vec2(0.0,1.0)),hash(i+vec2(1.0,1.0)),f.x),f.y);}
float fbm(vec2 p){float v=0.0,a=0.5;for(int i=0;i<4;i++){v+=a*vnoise(p);p=p*2.03+vec2(1.7,9.2);a*=0.5;}return v/0.9375;}
vec3 graded(vec3 c,vec4 g,vec4 h){c*=exp2(g.x);c=(c-0.5)*g.y+0.5;float s=g.z;mat3 m=mat3(0.213+0.787*s,0.213-0.213*s,0.213-0.213*s,0.715-0.715*s,0.715+0.285*s,0.715-0.715*s,0.072-0.072*s,0.072-0.072*s,0.072+0.928*s);c=clamp(m*clamp(c,0.0,1.0),0.0,1.0);
 if(h.z!=0.0){float r=radians(h.z),a=cos(r),b=sin(r);mat3 q=mat3(0.213+0.787*a-0.213*b,0.213-0.213*a+0.143*b,0.213-0.213*a-0.787*b,0.715-0.715*a-0.715*b,0.715+0.285*a+0.140*b,0.715-0.715*a+0.715*b,0.072-0.072*a+0.928*b,0.072-0.072*a-0.283*b,0.072+0.928*a+0.072*b);c=clamp(q*c,0.0,1.0);}
 float k=clamp(g.w,-1.0,1.0);c=clamp(c*vec3(1.0+0.25*k,1.0+0.04*k,1.0-0.25*k),0.0,1.0);
 if(h.x!=0.0){float t=clamp(h.x,-1.0,1.0);c=clamp(c*vec3(1.0+0.1*t,1.0-0.12*t,1.0+0.1*t),0.0,1.0);}
 if(h.w!=0.0){float l=dot(c,vec3(0.2126,0.7152,0.0722));c=mix(c,c*vec3(0.82,1.04,1.12),h.w*(1.0-l)*0.7);c=mix(c,c*vec3(1.12,1.0,0.84),h.w*l*0.7);c=clamp(c,0.0,1.0);}
 if(h.y!=0.0)c=h.y*0.22+c*(1.0-h.y*0.3);
 return clamp(c,0.0,1.0);}
vec4 pick(vec2 uv){vec4 c=texture(picture,clamp(uv,0.0,1.0));if(bgra)c=c.bgra;return c;}
vec4 soft(vec2 uv,float radius){vec4 sum=vec4(0.0);float total=0.0;for(int i=-3;i<=3;i++)for(int j=-3;j<=3;j++){vec2 o=vec2(float(i),float(j))*radius/1.5;float w=exp(-dot(o,o)/(2.0*radius*radius));sum+=pick(uv+o*texel)*w;total+=w;}return sum/total;}
vec4 look(vec2 uv){return blur>0.0?soft(uv,blur):pick(uv);}
vec4 moving(vec2 uv){vec2 streak=fxD.xy,radial=(frameSize*0.5-fp)*fxC.z*0.35;if(streak==vec2(0.0)&&fxC.z<=0.0)return look(uv);
 vec4 sum=vec4(0.0);for(int i=0;i<16;i++){float t=float(i)/15.0;sum+=look(uv+(streak*(t-0.5)+radial*t)*texel);}return sum/16.0;}
vec3 screen(vec3 c,vec3 light){return 1.0-(1.0-c)*(1.0-clamp(light,0.0,1.0));}
vec3 burnt(vec3 c,float amount){vec2 q=fp/frameSize.y;float v=fxC.w;vec2 corner=vec2(hash(vec2(v,1.0))>0.5?frameSize.x/frameSize.y:0.0,hash(vec2(v,2.0))>0.5?1.0:0.0);
 float base=fbm(q*2.5+vec2(fxD.z*0.6,v*3.1))*0.6+clamp(1.0-distance(q,corner)/1.8,0.0,1.0)*0.4,heat=clamp((base-(1.0-amount*1.25))*3.0,0.0,1.0);
 vec3 fire=mix(vec3(0.85,0.18,0.02),vec3(1.0,0.62,0.18),smoothstep(0.0,0.5,heat));fire=mix(fire,vec3(1.0,0.97,0.9),smoothstep(0.55,1.0,heat));
 return mix(screen(c,fire*min(1.0,heat*1.6)),fire,smoothstep(0.7,1.0,heat));}
vec3 leaked(vec3 c,float amount){vec2 q=fp/frameSize,a=vec2(frameSize.x/frameSize.y,1.0);float v=fxC.w,t=fxD.z;
 vec2 c1=vec2(-0.3+fract(t*0.25+v*0.13)*1.6,0.25+0.25*sin(t*0.9+v)),c2=vec2(1.3-fract(t*0.18+v*0.29)*1.6,0.75+0.2*cos(t*0.7+v*2.0));
 float l1=exp(-dot((q-c1)*a,(q-c1)*a)*3.0),l2=exp(-dot((q-c2)*a,(q-c2)*a)*4.0);
 return screen(c,(vec3(1.0,0.45,0.15)*l1+vec3(1.0,0.3,0.45)*l2*0.8+vec3(1.0,0.75,0.4)*0.15)*amount*1.4);}
void main(){fp=vec2(gl_FragCoord.x,canvas.y-gl_FragCoord.y)/frameScale;float m=1.0;
 if(maskKind==1){vec2 d=min(fp-maskRect.xy,maskRect.xy+maskRect.zw-fp);m=clamp(min(d.x,d.y)*frameScale+0.5,0.0,1.0);}
 else if(maskKind==2)m=clamp((maskCircle.z-distance(fp,maskCircle.xy))*frameScale+0.5,0.0,1.0);
 else if(maskKind==3){float e=dot(fp,maskRect.xy)-maskRect.z;m=maskRect.w>0.0?smoothstep(-maskRect.w,maskRect.w,e):clamp(e*frameScale+0.5,0.0,1.0);}
 else if(maskKind==4){vec2 d=fp-maskCircle.xy;float a=atan(d.x,-d.y);if(a<0.0)a+=6.2831853;m=maskCircle.z>=6.2831853?1.0:clamp((maskCircle.z-a)*length(d)*frameScale+0.5,0.0,1.0);}
 else if(maskKind==5){float f=mod(maskRect.z>0.5?fp.x:fp.y,maskRect.x);m=maskRect.y>=1.0?1.0:clamp((maskRect.y*maskRect.x-f)*frameScale+0.5,0.0,1.0);}
 if(solid){colour=vec4(fill.rgb*fill.a*opacity*m,fill.a*opacity*m);return;}
 vec2 uv=v_uv;float seed=mod(fxB.w,97.0);
 if(fxB.z>0.0){float band=floor(fp.y/(frameSize.y*0.045));if(hash(vec2(band,seed))>0.55)uv.x+=(hash(vec2(band+7.0,seed))-0.5)*fxB.z*frameSize.x*0.06*texel.x;}
 if(fxB.y>1.0){vec2 cell=fxB.y*texel;uv=(floor(uv/cell)+0.5)*cell;}
 vec4 c=moving(uv);
 if(fxA.w>0.0){vec2 o=vec2(fxA.w*texel.x,0.0);vec4 r=look(uv+o),b=look(uv-o);float a=max(c.a,max(r.a,b.a));vec3 u=vec3(r.a>0.0?r.r/r.a:0.0,c.a>0.0?c.g/c.a:0.0,b.a>0.0?b.b/b.a:0.0);c=vec4(u*a,a);}
 vec3 rgb=c.a>0.0?c.rgb/c.a:c.rgb;for(int i=0;i<4;i++){if(i>=grades)break;rgb=graded(rgb,grade[i*2],grade[i*2+1]);}
 if(fxA.z>0.0){vec4 g=soft(uv,10.0*frameSize.y/1080.0);vec3 gr=g.a>0.0?g.rgb/g.a:g.rgb;rgb+=max(gr-0.55,0.0)/0.45*fxA.z*0.9;}
 if(fxA.x>0.0){vec2 q=(fp/frameSize-0.5)*vec2(frameSize.x/frameSize.y,1.0);rgb*=1.0-fxA.x*smoothstep(0.3,0.95,length(q)/max(0.5,0.5*frameSize.x/frameSize.y));}
 if(fxB.x>0.0)rgb*=1.0-fxB.x*0.35*(0.5+0.5*cos(fp.y*1.5708));
 if(fxA.y>0.0)rgb+=(hash(floor(fp/1.5)+seed*0.137)-0.5)*fxA.y*0.22;
 if(fxC.x>0.0)rgb=burnt(clamp(rgb,0.0,1.0),fxC.x);
 if(fxC.y>0.0)rgb=leaked(clamp(rgb,0.0,1.0),fxC.y);
 rgb=clamp(rgb,0.0,1.0);float a=c.a*opacity*m;colour=vec4(rgb*a,a);}`;

const parseColour=(css:string):[number,number,number,number]=>{
 const hex=/^#([0-9a-f]{3,8})$/i.exec(css.trim());if(hex){let h=hex[1];if(h.length<=4)h=h.split('').map(c=>c+c).join('');const n=(i:number)=>parseInt(h.slice(i,i+2),16)/255;return[n(0),n(2),n(4),h.length===8?n(6):1];}
 const rgb=/^rgba?\(([^)]+)\)$/i.exec(css.trim());if(rgb){const v=rgb[1].split(/[ ,/]+/).filter(Boolean).map(Number);return[v[0]/255,v[1]/255,v[2]/255,v[3]??1];}
 return[0,0,0,1];
};

/** Draws frames on a canvas with WebGL2: the same layers in the player and in Export, so they show the same picture. The
 * canvas may be any size; the frame is scaled to it. */
export class Compositor{
 private gl:WebGL2RenderingContext;private program:WebGLProgram;private quad:WebGLVertexArrayObject;private textures=new Map<string,{texture:WebGLTexture;picture?:Picture;width:number;height:number;bgra:boolean}>();
 private text:OffscreenCanvas;private textContext:OffscreenCanvasRenderingContext2D;private u:Record<string,WebGLUniformLocation|null>={};
 constructor(readonly canvas:HTMLCanvasElement|OffscreenCanvas,options:{transparent?:boolean}={}){
  const gl=canvas.getContext('webgl2',{alpha:!!options.transparent,antialias:true,premultipliedAlpha:true,preserveDrawingBuffer:true}) as WebGL2RenderingContext|null;if(!gl)throw new Error('This computer cannot draw the video with its graphics card (WebGL2 is unavailable).');this.gl=gl;
  const shader=(type:number,source:string)=>{const s=gl.createShader(type)!;gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw new Error('Shader: '+gl.getShaderInfoLog(s));return s;};
  const program=gl.createProgram()!;gl.attachShader(program,shader(gl.VERTEX_SHADER,VERTEX));gl.attachShader(program,shader(gl.FRAGMENT_SHADER,FRAGMENT));gl.linkProgram(program);if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error('Program: '+gl.getProgramInfoLog(program));this.program=program;
  for(const name of ['rect','matrix','view','uv','picture','opacity','grades','grade','blur','texel','fill','solid','bgra','canvas','frameScale','frameSize','maskKind','maskRect','maskCircle','fxA','fxB','fxC','fxD'])this.u[name]=gl.getUniformLocation(program,name);
  this.quad=gl.createVertexArray()!;gl.bindVertexArray(this.quad);const buffer=gl.createBuffer();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([0,0,1,0,0,1,1,1]),gl.STATIC_DRAW);
  const corner=gl.getAttribLocation(program,'corner');gl.enableVertexAttribArray(corner);gl.vertexAttribPointer(corner,2,gl.FLOAT,false,0,0);
  this.text=new OffscreenCanvas(1,1);this.textContext=this.text.getContext('2d')!;
 }
 private texture(key:string,picture:Picture,static_=false){
  const gl=this.gl;let entry=this.textures.get(key);
  if(!entry){const texture=gl.createTexture()!;gl.bindTexture(gl.TEXTURE_2D,texture);for(const [p,v] of [[gl.TEXTURE_MIN_FILTER,gl.LINEAR],[gl.TEXTURE_MAG_FILTER,gl.LINEAR],[gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE],[gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE]])gl.texParameteri(gl.TEXTURE_2D,p,v);entry={texture,width:0,height:0,bgra:false};this.textures.set(key,entry);}
  gl.bindTexture(gl.TEXTURE_2D,entry.texture);
  if(!static_||entry.picture!==picture){entry.picture=picture;entry.bgra=isRaw(picture);
   if(isRaw(picture)){gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,false);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,picture.width,picture.height,0,gl.RGBA,gl.UNSIGNED_BYTE,picture.data);entry.width=picture.width;entry.height=picture.height;return entry;}
   gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,picture);
   const size=picture as {videoWidth?:number;displayWidth?:number;width?:number;videoHeight?:number;displayHeight?:number;height?:number};entry.width=size.videoWidth||size.displayWidth||size.width||1;entry.height=size.videoHeight||size.displayHeight||size.height||1;}
  return entry;
 }
 private quadDraw(rect:Rect,matrix:Matrix,uv:Rect,opacity:number,frame:Frame,o:{fill?:[number,number,number,number];grades?:Grade[];blur?:number;texel?:[number,number];bgra?:boolean;mask?:Mask;fx?:Fx}={}){
  const gl=this.gl,u=this.u;gl.uniform4f(u.rect,rect.x,rect.y,rect.w,rect.h);gl.uniformMatrix3fv(u.matrix,false,[matrix[0],matrix[1],0,matrix[2],matrix[3],0,matrix[4],matrix[5],1]);gl.uniform2f(u.view,frame.width,frame.height);gl.uniform4f(u.uv,uv.x,uv.y,uv.w,uv.h);gl.uniform1f(u.opacity,opacity);
  gl.uniform1i(u.solid,o.fill?1:0);gl.uniform1i(u.bgra,o.bgra?1:0);if(o.fill)gl.uniform4f(u.fill,...o.fill);
  const grades=(o.grades??[]).slice(0,4);gl.uniform1i(u.grades,grades.length);if(grades.length)gl.uniform4fv(u.grade,grades.flatMap(g=>[g.exposure,g.contrast,g.saturation,g.temperature,g.tint??0,g.fade??0,g.hue??0,g.splitTone??0]).concat(Array(32-grades.length*8).fill(0)));
  gl.uniform1f(u.blur,o.blur??0);gl.uniform2f(u.texel,...(o.texel??[0,0]));
  const m=o.mask;gl.uniform1i(u.maskKind,!m?0:{rect:1,circle:2,edge:3,clock:4,stripes:5}[m.kind]);
  if(m?.kind==='rect')gl.uniform4f(u.maskRect,m.rect.x,m.rect.y,m.rect.w,m.rect.h);if(m?.kind==='circle')gl.uniform3f(u.maskCircle,m.cx,m.cy,m.r);
  if(m?.kind==='edge')gl.uniform4f(u.maskRect,m.nx,m.ny,m.d,m.feather);if(m?.kind==='clock')gl.uniform3f(u.maskCircle,m.cx,m.cy,m.sweep);if(m?.kind==='stripes')gl.uniform4f(u.maskRect,m.period,m.open,m.vertical?1:0,0);
  const fx=o.fx;gl.uniform4f(u.fxA,fx?.vignette??0,fx?.grain??0,fx?.glow??0,fx?.split??0);gl.uniform4f(u.fxB,fx?.scan??0,fx?.pixel??0,fx?.jitter??0,fx?.seed??0);
  gl.uniform4f(u.fxC,fx?.burn??0,fx?.leak??0,fx?.zoomBlur??0,fx?.variant??0);gl.uniform4f(u.fxD,fx?.streakX??0,fx?.streakY??0,fx?.phase??0,0);
  gl.drawArrays(gl.TRIANGLE_STRIP,0,4);
 }
 /** Draws a frame. Layers whose picture is not available yet are skipped (the player shows the last picture it had). */
 draw(frame:Frame,source:PictureSource){
  const gl=this.gl,width=this.canvas.width,height=this.canvas.height,scale=width/frame.width;
  gl.viewport(0,0,width,height);gl.useProgram(this.program);gl.bindVertexArray(this.quad);gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);
  gl.uniform2f(this.u.canvas,width,height);gl.uniform1f(this.u.frameScale,scale);gl.uniform2f(this.u.frameSize,frame.width,frame.height);
  if(frame.background==='transparent')gl.clearColor(0,0,0,0);else{const [r,g,b]=parseColour(frame.background);gl.clearColor(r,g,b,1);}gl.clear(gl.COLOR_BUFFER_BIT);gl.activeTexture(gl.TEXTURE0);gl.uniform1i(this.u.picture,0);
  const full={x:0,y:0,w:frame.width,h:frame.height},none:Matrix=[1,0,0,1,0,0];
  for(let n=0;n<frame.layers.length;n++){const layer=frame.layers[n];
   if(layer.kind==='fill'){if(layer.opacity>0)this.quadDraw(layer.rect,layer.transform,{x:0,y:0,w:1,h:1},layer.opacity,frame,{fill:parseColour(layer.color),mask:layer.mask});continue;}
   if(layer.kind==='media'){if(layer.opacity<=0||!layer.rect.w||!layer.rect.h)continue;const picture=source(layer);if(!picture)continue;
    // Video and scene layers each keep one texture; stills are uploaded once. A video's picture is uploaded every frame (an
    // element or decoder may reuse the object); a scene's only when it is a new picture (the same one while it holds still).
    const live=layer.media==='video'||layer.media==='scene',entry=this.texture(live?layer.media+':'+layer.key:'still:'+layer.assetId+':'+(layer.frameIndex??0),picture,layer.media!=='video');
    this.quadDraw(layer.rect,layer.transform,layer.uv,layer.opacity,frame,{grades:layer.grades,blur:layer.blur,texel:[layer.uv.w/layer.rect.w,layer.uv.h/layer.rect.h],bgra:entry.bgra,mask:layer.mask,fx:layer.fx});continue;}
   // Consecutive text layers are painted together on one canvas the size of the output, then drawn over the frame.
   const run:TextLayer[]=[];while(n<frame.layers.length&&frame.layers[n].kind==='text')run.push(frame.layers[n++] as TextLayer);n--;
   if(this.text.width!==width||this.text.height!==height){this.text.width=width;this.text.height=height;}
   this.textContext.clearRect(0,0,width,height);for(const t of run)paintText(this.textContext,t,frame.width,frame.height,scale);
   this.texture('text',this.text);this.quadDraw(full,none,{x:0,y:0,w:1,h:1},1,frame);
  }
 }
 /** Lets go of every picture (a new edit or project draws next) but keeps the context and its shaders, which take a third
  * of a second to build; the canvas is cleared, as a new one would be. */
 forget(){for(const {texture} of this.textures.values())this.gl.deleteTexture(texture);this.textures.clear();const gl=this.gl;gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);}
 dispose(){this.forget();this.gl.deleteProgram(this.program);}
}
