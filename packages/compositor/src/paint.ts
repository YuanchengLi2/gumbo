import type {TextLayer} from './frame';
import {paintSticker} from './stickers';
type Context=CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D;

/** Draws text, elements, stickers and captions with Canvas2D, laid out as the player's HTML laid them out: Arial, centred
 * lines that wrap at a share of the frame's width, CSS's normal line height, padding, rounded boxes and the soft text
 * shadow. Text styles add a font, italics, letter spacing, an outline, their own shadow, a glow, and a typewriter reveal.
 * Sizes are in frame pixels; scale turns them into canvas pixels. */
const LINE=1.149;
function lines(ctx:Context,text:string,maxWidth:number){
 const out:string[]=[];for(const paragraph of text.split('\n')){let line='';for(const word of paragraph.split(/(\s+)/)){const next=line+word;if(line.trim()&&ctx.measureText(next.trimEnd()).width>maxWidth){out.push(line.trimEnd());line=word.trimStart();}else line=next;}out.push(line.trimEnd());}
 return out;
}
function roundRect(ctx:Context,x:number,y:number,w:number,h:number,r:number){ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}
type BlockOptions={fontSize:number;fontWeight:number;color:string;maxWidth:number;padX?:number;padY?:number;background?:string;radius?:number;shadow?:boolean;words?:TextLayer['words'];
 fontFamily?:string;italic?:boolean;letterSpacing?:number;stroke?:string;strokeWidth?:number;shadowColor?:string;shadowBlur?:number;shadowX?:number;shadowY?:number;glow?:string;glowSize?:number;reveal?:number};
const fontOf=(o:Pick<BlockOptions,'fontSize'|'fontWeight'|'fontFamily'|'italic'>)=>`${o.italic?'italic ':''}${o.fontWeight} ${o.fontSize}px ${o.fontFamily?`"${o.fontFamily}", `:''}Arial, sans-serif`;
/** Where a block's lines go and how big its box is, without drawing it. */
function layout(ctx:Context,text:string,o:BlockOptions){
 ctx.font=fontOf(o);ctx.textBaseline='middle';ctx.textAlign='left';(ctx as CanvasRenderingContext2D).letterSpacing=`${o.letterSpacing??0}px`;
 const padX=o.padX??0,padY=o.padY??0,rows=lines(ctx,text,o.maxWidth-padX*2),lineHeight=o.fontSize*LINE,width=Math.min(o.maxWidth,Math.max(...rows.map(r=>ctx.measureText(r).width))+padX*2),height=rows.length*lineHeight+padY*2;
 return{padX,padY,rows,lineHeight,width,height};
}
/** A block of text centred on (0,0) in the current transform, inside an optional padded box. */
function block(ctx:Context,text:string,o:BlockOptions){
 const {padY,rows,lineHeight,width,height}=layout(ctx,text,o);
 if(o.background){ctx.fillStyle=o.background;roundRect(ctx,-width/2,-height/2,width,height,o.radius??0);ctx.fill();}
 // The typewriter shows the first characters only, laid out where the whole text puts them, so lines never reflow.
 let left=o.reveal===undefined?Infinity:Math.round(o.reveal*rows.reduce((n,r)=>n+r.length,0));
 const visible=rows.map(row=>{const shown=row.slice(0,Math.max(0,left));left-=row.length;return shown;});
 const pass=(draw:(row:string,x:number,y:number)=>void)=>rows.forEach((row,n)=>{const y=-height/2+padY+lineHeight*(n+.5),x=-ctx.measureText(row).width/2;if(visible[n])draw(visible[n],x,y);});
 const shadow=(colour:string,blur:number,x=0,y=0)=>{ctx.shadowColor=colour;ctx.shadowBlur=blur;ctx.shadowOffsetX=x;ctx.shadowOffsetY=y;},none=()=>shadow('transparent',0);
 if(o.glow){shadow(o.glow,o.glowSize??24);ctx.fillStyle=o.glow;pass((row,x,y)=>{ctx.fillText(row,x,y);ctx.fillText(row,x,y);});none();}
 if(o.shadowColor)shadow(o.shadowColor,o.shadowBlur??0,o.shadowX??0,o.shadowY??0);else if(o.shadow)shadow('rgba(0,0,0,.53)',12,0,2);
 if(o.stroke&&o.strokeWidth){ctx.strokeStyle=o.stroke;ctx.lineWidth=o.strokeWidth;ctx.lineJoin='round';pass((row,x,y)=>ctx.strokeText(row,x,y));none();}
 pass((row,x,y)=>{if(o.words){for(const piece of row.split(' ')){const word=o.words.find(w=>w.text===piece);ctx.fillStyle=word?.highlight?'#a5b8ff':o.color;ctx.fillText(piece,x,y);x+=ctx.measureText(piece+' ').width;}}else{ctx.fillStyle=o.color;ctx.fillText(row,x,y);}});
 none();(ctx as CanvasRenderingContext2D).letterSpacing='0px';
 return{width,height};
}

/** The block options a text layer is painted with (title card, captions and the audio card fill the frame instead). */
function options(layer:TextLayer,width:number):BlockOptions{
 const text:BlockOptions={fontSize:layer.fontSize,fontWeight:layer.fontWeight,color:layer.color,maxWidth:width*.85,shadow:true,fontFamily:layer.fontFamily,italic:layer.italic,letterSpacing:layer.letterSpacing,stroke:layer.stroke,strokeWidth:layer.strokeWidth,
  shadowColor:layer.shadow,shadowBlur:layer.shadowBlur,shadowX:layer.shadowX,shadowY:layer.shadowY,glow:layer.glow,glowSize:layer.glowSize,reveal:layer.reveal,
  ...(layer.background&&layer.component==='text'?{background:layer.background,padX:layer.padding??18,padY:(layer.padding??18)*.7,radius:layer.radius??8}:{})};
 return layer.component==='lower_third'?{...text,padX:layer.padding??26,padY:(layer.padding??26)*16/26,background:layer.background??'#111418cc',radius:layer.radius??6}:layer.component==='callout_arrow'?{...text,fontSize:100}:text;
}
let measuring:OffscreenCanvasRenderingContext2D|undefined;
/** The box a text layer covers in frame pixels, before its rotation and scale about (x, y): what the editor's handles
 * outline and drag. Undefined for layers that fill the frame or sit in a fixed place (title cards, captions). */
export function textBounds(layer:TextLayer,width:number,height:number):{cx:number;cy:number;w:number;h:number}|undefined{
 if(layer.component==='caption'||layer.component==='title_card'||layer.component==='audio_card')return undefined;
 const cx=layer.x*width,cy=layer.y*height;
 if(layer.component==='circle_highlight'||layer.component==='sticker'){const size=layer.size??220;return{cx,cy,w:size,h:size};}
 if(layer.component==='progress_bar')return{cx,cy,w:500,h:12};
 measuring??=new OffscreenCanvas(1,1).getContext('2d')!;const box=layout(measuring,layer.component==='callout_arrow'?'↗':layer.text,{...options(layer,width),reveal:undefined});
 return{cx,cy,w:box.width,h:box.height};
}

export function paintText(ctx:Context,layer:TextLayer,width:number,height:number,scale:number){
 ctx.save();ctx.scale(scale,scale);ctx.globalAlpha=Math.max(0,Math.min(1,layer.opacity));
 if(layer.component==='caption'){
  // A box at the bottom centre, its bottom 5% of the frame's width above the frame's bottom.
  ctx.font=`${layer.fontWeight} ${layer.fontSize}px Arial, sans-serif`;const rows=lines(ctx,layer.text,width*.82-48),h=rows.length*layer.fontSize*LINE+28;
  ctx.translate(width/2,height-width*.05-h/2);block(ctx,layer.text,{fontSize:layer.fontSize,fontWeight:layer.fontWeight,color:layer.color,maxWidth:width*.82,padX:24,padY:14,background:layer.background,radius:8,words:layer.words});
  ctx.restore();return;}
 if(layer.component==='title_card'){ctx.fillStyle=layer.background??'#111418';ctx.fillRect(0,0,width,height);}
 if(layer.component==='audio_card'){ctx.fillStyle=layer.background??'#161c26';ctx.fillRect(0,0,width,height);ctx.translate(width/2,height/2);block(ctx,'♫\n\n'+layer.text,{fontSize:layer.fontSize,fontWeight:layer.fontWeight,color:layer.color,maxWidth:width});ctx.restore();return;}
 ctx.translate(layer.x*width,layer.y*height);ctx.rotate(layer.rotation*Math.PI/180);ctx.scale(layer.scale,layer.scale);
 if(layer.component==='sticker')paintSticker(ctx,layer.sticker??'',layer.size??220,layer.color,layer.background??'#ffffff',layer.time??0,layer.text);
 else if(layer.component==='circle_highlight'){const size=layer.size??220;ctx.strokeStyle=layer.color;ctx.lineWidth=6;ctx.beginPath();ctx.arc(0,0,size/2-3,0,Math.PI*2);ctx.stroke();}
 else if(layer.component==='progress_bar'){ctx.fillStyle='rgba(255,255,255,.2)';ctx.fillRect(-250,-6,500,12);ctx.fillStyle=layer.color;ctx.fillRect(-250,-6,500*(layer.progress??0)/100,12);}
 else block(ctx,layer.component==='callout_arrow'?'↗':layer.text,options(layer,width));
 ctx.restore();
}
