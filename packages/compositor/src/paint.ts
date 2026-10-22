import type {TextLayer} from './frame';
import {paintSticker} from './stickers';
type Context=CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D;

/** Draws text, elements, stickers and captions with Canvas2D, laid out as the player's HTML laid them out: Arial, centred
 * lines that wrap at a share of the frame's width, CSS's normal line height, padding, rounded boxes and the soft text
 * shadow. Text styles add a font, italics, letter spacing, an outline, their own shadow, a glow, a typewriter reveal (by
 * characters or words), left alignment, an accent bar and a smaller second line (lower thirds), and a blur. Sizes are in
 * frame pixels; scale turns them into canvas pixels. */
const LINE=1.149;
function lines(ctx:Context,text:string,maxWidth:number){
 const out:string[]=[];for(const paragraph of text.split('\n')){let line='';for(const word of paragraph.split(/(\s+)/)){const next=line+word;if(line.trim()&&ctx.measureText(next.trimEnd()).width>maxWidth){out.push(line.trimEnd());line=word.trimStart();}else line=next;}out.push(line.trimEnd());}
 return out;
}
function roundRect(ctx:Context,x:number,y:number,w:number,h:number,r:number){ctx.beginPath();ctx.moveTo(x+r,y);ctx.arcTo(x+w,y,x+w,y+h,r);ctx.arcTo(x+w,y+h,x,y+h,r);ctx.arcTo(x,y+h,x,y,r);ctx.arcTo(x,y,x+w,y,r);ctx.closePath();}
type BlockOptions={fontSize:number;fontWeight:number;color:string;maxWidth:number;padX?:number;padY?:number;background?:string;radius?:number;shadow?:boolean;words?:TextLayer['words'];
 fontFamily?:string;italic?:boolean;letterSpacing?:number;stroke?:string;strokeWidth?:number;shadowColor?:string;shadowBlur?:number;shadowX?:number;shadowY?:number;glow?:string;glowSize?:number;reveal?:number;
 revealBy?:'words';align?:'left'|'center';accent?:string;subtext?:string;subColor?:string};
const fontOf=(o:Pick<BlockOptions,'fontSize'|'fontWeight'|'fontFamily'|'italic'>)=>`${o.italic?'italic ':''}${o.fontWeight} ${o.fontSize}px ${o.fontFamily?`"${o.fontFamily}", `:''}Arial, sans-serif`;
/** The second line's font: a little over half the size, no heavier than semibold. */
const subFont=(o:BlockOptions)=>({...o,fontSize:Math.round(o.fontSize*.56),fontWeight:Math.min(o.fontWeight,600)});
/** Where a block's lines go and how big its box is, without drawing it. An accent bar takes an inset on the left. */
function layout(ctx:Context,text:string,o:BlockOptions){
 const inset=o.accent?Math.max(4,o.fontSize*.12)+o.fontSize*.3:0,padX=o.padX??0,padY=o.padY??0,room=o.maxWidth-padX*2-inset;
 let subRows:string[]=[],subWidth=0;const sub=subFont(o);
 if(o.subtext){ctx.font=fontOf(sub);subRows=lines(ctx,o.subtext,room);subWidth=Math.max(...subRows.map(r=>ctx.measureText(r).width));}
 ctx.font=fontOf(o);ctx.textBaseline='middle';ctx.textAlign='left';(ctx as CanvasRenderingContext2D).letterSpacing=`${o.letterSpacing??0}px`;
 const rows=lines(ctx,text,room),lineHeight=o.fontSize*LINE,subLine=sub.fontSize*LINE,gap=subRows.length?o.fontSize*.12:0;
 const width=Math.min(o.maxWidth,Math.max(subWidth,...rows.map(r=>ctx.measureText(r).width))+padX*2+inset),height=rows.length*lineHeight+gap+subRows.length*subLine+padY*2;
 return{padX,padY,rows,lineHeight,width,height,inset,subRows,subLine,gap,sub};
}
/** A block of text centred on (0,0) in the current transform, inside an optional padded box. */
function block(ctx:Context,text:string,o:BlockOptions){
 const {padX,padY,rows,lineHeight,width,height,inset,subRows,subLine,gap,sub}=layout(ctx,text,o);
 if(o.background){ctx.fillStyle=o.background;roundRect(ctx,-width/2,-height/2,width,height,o.radius??0);ctx.fill();}
 if(o.accent){ctx.fillStyle=o.accent;ctx.fillRect(-width/2+(o.background?0:padX),-height/2+(o.background?0:padY),Math.max(4,o.fontSize*.12),height-(o.background?0:padY*2));}
 // The typewriter shows the first characters (or words) only, laid out where the whole text puts them, so lines never reflow.
 const words=(row:string)=>row.split(/\s+/).filter(Boolean).length;
 let left=o.reveal===undefined?Infinity:Math.round(o.reveal*rows.reduce((n,r)=>n+(o.revealBy==='words'?words(r):r.length),0));
 const visible=rows.map(row=>{let shown:string;if(o.revealBy==='words'){const parts=row.split(/(\s+)/),keep:string[]=[];let n=Math.max(0,left);for(const part of parts){if(part.trim()){if(!n)break;n--;}keep.push(part);}shown=keep.join('').trimEnd();left-=words(row);}else{shown=row.slice(0,Math.max(0,left));left-=row.length;}return shown;});
 const startX=(row:string)=>o.align==='left'?-width/2+padX+inset:-ctx.measureText(row).width/2+inset/2;
 const pass=(draw:(row:string,x:number,y:number)=>void)=>rows.forEach((row,n)=>{const y=-height/2+padY+lineHeight*(n+.5),x=startX(row);if(visible[n])draw(visible[n],x,y);});
 const shadow=(colour:string,blur:number,x=0,y=0)=>{ctx.shadowColor=colour;ctx.shadowBlur=blur;ctx.shadowOffsetX=x;ctx.shadowOffsetY=y;},none=()=>shadow('transparent',0);
 if(o.glow){shadow(o.glow,o.glowSize??24);ctx.fillStyle=o.glow;pass((row,x,y)=>{ctx.fillText(row,x,y);ctx.fillText(row,x,y);});none();}
 if(o.shadowColor)shadow(o.shadowColor,o.shadowBlur??0,o.shadowX??0,o.shadowY??0);else if(o.shadow)shadow('rgba(0,0,0,.53)',12,0,2);
 if(o.stroke&&o.strokeWidth){ctx.strokeStyle=o.stroke;ctx.lineWidth=o.strokeWidth;ctx.lineJoin='round';pass((row,x,y)=>ctx.strokeText(row,x,y));none();}
 pass((row,x,y)=>{if(o.words){for(const piece of row.split(' ')){const word=o.words.find(w=>w.text===piece);ctx.fillStyle=word?.highlight?'#a5b8ff':o.color;ctx.fillText(piece,x,y);x+=ctx.measureText(piece+' ').width;}}else{ctx.fillStyle=o.color;ctx.fillText(row,x,y);}});
 none();(ctx as CanvasRenderingContext2D).letterSpacing='0px';
 if(subRows.length){ctx.font=fontOf(sub);ctx.fillStyle=o.subColor??o.color;if(o.shadowColor)shadow(o.shadowColor,o.shadowBlur??0,o.shadowX??0,o.shadowY??0);
  subRows.forEach((row,n)=>ctx.fillText(row,o.align==='left'?-width/2+padX+inset:-ctx.measureText(row).width/2+inset/2,-height/2+padY+rows.length*lineHeight+gap+subLine*(n+.5)));none();}
 return{width,height};
}
/** A caption line: its words laid out in rows across 82% of the frame (wrapping as text does), each in its colour, the
 * highlighted ones in the highlight colour or on the word box, the current one grown by its pop about its own middle,
 * and words not said yet keeping their place unseen; in an optional box. */
function caption(ctx:Context,layer:TextLayer,width:number){
 const o={fontSize:layer.fontSize,fontWeight:layer.fontWeight,fontFamily:layer.fontFamily},fs=layer.fontSize,padX=24,padY=14,maxWidth=width*.82,lineHeight=fs*LINE;
 ctx.font=fontOf(o);ctx.textBaseline='middle';ctx.textAlign='left';
 const words:NonNullable<TextLayer['words']>=layer.words??layer.text.split(' ').map(text=>({text,highlight:false})),space=ctx.measureText(' ').width,sizes=words.map(w=>ctx.measureText(w.text).width),rows:number[][]=[[]];
 let used=0;words.forEach((_,n)=>{const row=rows.at(-1)!,next=used+(row.length?space:0)+sizes[n];if(row.length&&next>maxWidth-padX*2){rows.push([n]);used=sizes[n];}else{row.push(n);used=next;}});
 const rowWidth=(row:number[])=>row.reduce((s,n)=>s+sizes[n],0)+space*Math.max(0,row.length-1),boxW=Math.min(maxWidth,Math.max(...rows.map(rowWidth))+padX*2),boxH=rows.length*lineHeight+padY*2;
 return{boxW,boxH,draw:()=>{
  if(layer.background){ctx.fillStyle=layer.background;roundRect(ctx,-boxW/2,-boxH/2,boxW,boxH,8);ctx.fill();}
  const shadow=(colour:string,blur:number,x=0,y=0)=>{ctx.shadowColor=colour;ctx.shadowBlur=blur;ctx.shadowOffsetX=x;ctx.shadowOffsetY=y;},none=()=>shadow('transparent',0);
  rows.forEach((row,r)=>{let x=-rowWidth(row)/2;const y=-boxH/2+padY+lineHeight*(r+.5);for(const n of row){const w=words[n],size=sizes[n];
   if(!w.hidden){ctx.save();ctx.translate(x+size/2,y);if(w.scale&&w.scale!==1)ctx.scale(w.scale,w.scale);const left=-size/2;
    if(w.highlight&&layer.wordBox){ctx.fillStyle=layer.wordBox;roundRect(ctx,left-fs*.18,-fs*.62,size+fs*.36,fs*1.24,fs*.18);ctx.fill();}
    if(layer.glow){shadow(layer.glow,layer.glowSize??24);ctx.fillStyle=layer.glow;ctx.fillText(w.text,left,0);ctx.fillText(w.text,left,0);none();}
    if(layer.shadow)shadow(layer.shadow,layer.shadowBlur??0,layer.shadowX??0,layer.shadowY??0);
    if(layer.stroke&&layer.strokeWidth){ctx.strokeStyle=layer.stroke;ctx.lineWidth=layer.strokeWidth;ctx.lineJoin='round';ctx.strokeText(w.text,left,0);none();}
    ctx.fillStyle=w.highlight&&!layer.wordBox?layer.highlightColor??'#a5b8ff':layer.color;ctx.fillText(w.text,left,0);none();ctx.restore();}
   x+=size+space;}});}};
}

/** The block options a text layer is painted with (title card, captions and the audio card fill the frame instead). */
function options(layer:TextLayer,width:number):BlockOptions{
 const text:BlockOptions={fontSize:layer.fontSize,fontWeight:layer.fontWeight,color:layer.color,maxWidth:width*.85,shadow:true,fontFamily:layer.fontFamily,italic:layer.italic,letterSpacing:layer.letterSpacing,stroke:layer.stroke,strokeWidth:layer.strokeWidth,
  shadowColor:layer.shadow,shadowBlur:layer.shadowBlur,shadowX:layer.shadowX,shadowY:layer.shadowY,glow:layer.glow,glowSize:layer.glowSize,reveal:layer.reveal,revealBy:layer.revealBy,align:layer.align,accent:layer.accent,subtext:layer.subtext,subColor:layer.subColor,
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
 // Left-aligned text (lower thirds) grows to the right of x: its box, and the turn and scale about it, sit on the box's middle.
 return{cx:cx+(layer.align==='left'?box.width/2:0),cy,w:box.width,h:box.height};
}

export function paintText(ctx:Context,layer:TextLayer,width:number,height:number,scale:number){
 ctx.save();ctx.scale(scale,scale);ctx.globalAlpha=Math.max(0,Math.min(1,layer.opacity));
 if(layer.component==='caption'){
  // A box at the bottom centre, its bottom 5% of the frame's width above the frame's bottom; or centred at y when it is set.
  const line=caption(ctx,layer,width);ctx.translate(width/2,layer.y<1?layer.y*height:height-width*.05-line.boxH/2);line.draw();
  ctx.restore();return;}
 if(layer.component==='title_card'){ctx.fillStyle=layer.background??'#111418';ctx.fillRect(0,0,width,height);}
 if(layer.component==='audio_card'){ctx.fillStyle=layer.background??'#161c26';ctx.fillRect(0,0,width,height);ctx.translate(width/2,height/2);block(ctx,'♫\n\n'+layer.text,{fontSize:layer.fontSize,fontWeight:layer.fontWeight,color:layer.color,maxWidth:width});ctx.restore();return;}
 if(layer.blur)ctx.filter=`blur(${layer.blur*scale}px)`;
 const across=layer.align==='left'&&layer.component==='text'?layout(ctx,layer.text,{...options(layer,width),reveal:undefined}).width/2:0;
 ctx.translate(layer.x*width+across,layer.y*height);ctx.rotate(layer.rotation*Math.PI/180);ctx.scale(layer.scale,layer.scale);
 if(layer.component==='sticker')paintSticker(ctx,layer.sticker??'',layer.size??220,layer.color,layer.background??'#ffffff',layer.time??0,layer.text);
 else if(layer.component==='circle_highlight'){const size=layer.size??220;ctx.strokeStyle=layer.color;ctx.lineWidth=6;ctx.beginPath();ctx.arc(0,0,size/2-3,0,Math.PI*2);ctx.stroke();}
 else if(layer.component==='progress_bar'){ctx.fillStyle='rgba(255,255,255,.2)';ctx.fillRect(-250,-6,500,12);ctx.fillStyle=layer.color;ctx.fillRect(-250,-6,500*(layer.progress??0)/100,12);}
 else block(ctx,layer.component==='callout_arrow'?'↗':layer.text,options(layer,width));
 ctx.restore();
}
