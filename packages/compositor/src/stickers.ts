type Context=CanvasRenderingContext2D|OffscreenCanvasRenderingContext2D;

/** Gumbo's stickers, drawn as vectors with Canvas2D (original drawings, no image files): in a 100-unit box centred on the
 * origin, scaled to size. time is seconds since the sticker appeared, for the ones that move inside (sparkles twinkle,
 * fire flickers, the sun turns, confetti falls). The player, Export and the library's tiles all draw them with this. */
export function paintSticker(ctx:Context,id:string,size:number,color:string,accent:string,time=0,text=''){
 ctx.save();ctx.scale(size/100,size/100);ctx.lineJoin='round';ctx.lineCap='round';
 const fill=(c:string)=>{ctx.fillStyle=c;ctx.fill();},stroke=(c:string,w:number)=>{ctx.strokeStyle=c;ctx.lineWidth=w;ctx.stroke();};
 const poly=(points:number[][])=>{ctx.beginPath();points.forEach(([x,y],n)=>n?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();};
 const star=(points:number,outer:number,inner:number,turn=-Math.PI/2)=>{const out:number[][]=[];for(let i=0;i<points*2;i++){const r=i%2?inner:outer,a=turn+i*Math.PI/points;out.push([Math.cos(a)*r,Math.sin(a)*r]);}poly(out);};
 const circle=(x:number,y:number,r:number)=>{ctx.beginPath();ctx.arc(x,y,r,0,Math.PI*2);};
 const ellipse=(x:number,y:number,rx:number,ry:number,turn=0)=>{ctx.beginPath();ctx.ellipse(x,y,rx,ry,turn,0,Math.PI*2);};
 const arc=(x:number,y:number,r:number,a:number,b:number,c:string,w:number)=>{ctx.beginPath();ctx.arc(x,y,r,a*Math.PI,b*Math.PI);stroke(c,w);};
 const round=(x:number,y:number,w:number,h:number,r:number)=>{ctx.beginPath();ctx.roundRect(x,y,w,h,r);};
 const heart=(x:number,y:number,s:number)=>{ctx.beginPath();ctx.moveTo(x,y+.4*s);ctx.bezierCurveTo(x-.6*s,y,x-.45*s,y-.45*s,x,y-.22*s);ctx.bezierCurveTo(x+.45*s,y-.45*s,x+.6*s,y,x,y+.4*s);ctx.closePath();};
 const sparkle=(x:number,y:number,r:number)=>{ctx.beginPath();ctx.moveTo(x,y-r);ctx.quadraticCurveTo(x+r*.12,y-r*.12,x+r,y);ctx.quadraticCurveTo(x+r*.12,y+r*.12,x,y+r);ctx.quadraticCurveTo(x-r*.12,y+r*.12,x-r,y);ctx.quadraticCurveTo(x-r*.12,y-r*.12,x,y-r);ctx.closePath();};
 const face=()=>{circle(0,0,46);fill(color);stroke('rgba(0,0,0,.18)',3);};
 const eyes=(ry=8)=>{ellipse(-16,-10,5,ry);fill(accent);ellipse(16,-10,5,ry);fill(accent);};
 const hash=(n:number)=>{const x=Math.sin(n*12.9898)*43758.5453;return x-Math.floor(x);};
 const label=(words:string,c:string,px:number,maxWidth:number)=>{ctx.fillStyle=c;ctx.font=`700 ${px}px "Segoe UI", Arial, sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';
  const lines:string[]=[];let line='';for(const word of words.split(/\s+/).filter(Boolean)){const next=line?line+' '+word:word;if(line&&ctx.measureText(next).width>maxWidth){lines.push(line);line=word;}else line=next;}if(line)lines.push(line);
  const shown=lines.slice(0,3);shown.forEach((l,n)=>ctx.fillText(l,0,(n-(shown.length-1)/2)*px*1.15-6,maxWidth));};
 switch(id){
  case 'star':star(5,46,19);fill(color);stroke(accent,4);break;
  case 'heart':heart(0,0,100);fill(color);ellipse(-20,-16,9,6,-.6);fill('rgba(255,255,255,.45)');break;
  case 'sparkle':{const k=.75+.25*Math.abs(Math.sin(time*4)),j=.6+.4*Math.abs(Math.sin(time*4+1.7));sparkle(0,0,46*k);fill(color);stroke(accent,3);sparkle(30,-30,16*j);fill(accent);sparkle(-30,28,11*(1.6-j));fill(accent);break;}
  case 'burst':star(14,48,34);fill(color);star(14,32,22,-Math.PI/2+.1);fill(accent);break;
  case 'ring':circle(0,0,40);stroke(color,8);break;
  case 'lightning':poly([[8,-48],[-26,6],[-2,6],[-12,48],[26,-10],[2,-10],[14,-48]]);fill(color);stroke(accent,3);break;
  case 'fire':{ctx.save();ctx.scale(1,1+.05*Math.sin(time*13));const flame=(s:number,dy:number,c:string)=>{ctx.save();ctx.translate(0,dy);ctx.scale(s,s);ctx.beginPath();ctx.moveTo(0,-46);ctx.bezierCurveTo(30,-20,40,10,28,28);ctx.bezierCurveTo(18,44,-18,44,-28,28);ctx.bezierCurveTo(-40,10,-22,-8,-10,-22);ctx.bezierCurveTo(-8,-8,6,-12,0,-46);ctx.closePath();fill(c);ctx.restore();};flame(1,0,color);flame(.55,16,accent);ctx.restore();break;}
  case 'sun':{ctx.save();ctx.rotate(time*.5);for(let i=0;i<12;i++){const a=i*Math.PI/6;ctx.beginPath();ctx.moveTo(Math.cos(a)*32,Math.sin(a)*32);ctx.lineTo(Math.cos(a)*46,Math.sin(a)*46);stroke(accent,6);}ctx.restore();circle(0,0,25);fill(color);break;}
  case 'cloud':{const shape=(dy:number)=>{ctx.beginPath();ctx.arc(-22,8+dy,18,0,Math.PI*2);ctx.arc(0,-6+dy,24,0,Math.PI*2);ctx.arc(22,6+dy,18,0,Math.PI*2);ctx.roundRect(-38,6+dy,76,22,11);};shape(5);fill(accent);shape(0);fill(color);break;}
  case 'music':{ellipse(-22,30,12,9,-.35);fill(color);ellipse(20,22,12,9,-.35);fill(color);poly([[-12,-34],[31,-42],[31,-30],[-12,-22]]);fill(color);ctx.beginPath();ctx.moveTo(-11,28);ctx.lineTo(-11,-30);ctx.moveTo(30,20);ctx.lineTo(30,-38);stroke(color,5);
   ellipse(-22,30,12,9,-.35);stroke(accent,2);ellipse(20,22,12,9,-.35);stroke(accent,2);break;}
  case 'confetti':{const colours=[color,accent,'#ffd23f','#22c55e','#a78bfa'];for(let i=0;i<18;i++){const x=hash(i)*90-45,y=((hash(i+50)*100+time*45)%100)-50;ctx.save();ctx.translate(x,y);ctx.rotate(time*3+i);ctx.fillStyle=colours[i%colours.length];ctx.fillRect(-4,-2,8,4);ctx.restore();}break;}
  case 'crown':poly([[-40,30],[-44,-20],[-20,4],[0,-34],[20,4],[44,-20],[40,30]]);fill(color);stroke('rgba(0,0,0,.15)',2);round(-40,20,80,12,3);fill(accent);for(const [x,y] of [[-44,-20],[0,-34],[44,-20]]){circle(x,y,5);fill(accent);}break;
  case 'smile':face();eyes();arc(0,4,24,.15,.85,accent,6);break;
  case 'laugh':face();arc(-16,-6,8,1.1,1.9,accent,5);arc(16,-6,8,1.1,1.9,accent,5);ctx.beginPath();ctx.moveTo(-26,8);ctx.lineTo(26,8);ctx.arc(0,8,26,0,Math.PI);ctx.closePath();fill(accent);ellipse(0,26,10,6);fill('#ff6b81');
   for(const s of [-1,1]){ctx.beginPath();ctx.moveTo(s*36,-8);ctx.quadraticCurveTo(s*44,4,s*36,10);ctx.quadraticCurveTo(s*28,4,s*36,-8);fill('#5ac8fa');}break;
  case 'love':face();heart(-16,-8,22);fill(accent);heart(16,-8,22);fill(accent);arc(0,6,22,.15,.85,'#3b2a14',6);break;
  case 'wow':face();eyes(9);arc(-16,-26,8,1.15,1.85,accent,4);arc(16,-26,8,1.15,1.85,accent,4);ellipse(0,22,9,12);fill(accent);break;
  case 'cool':face();round(-36,-20,30,20,8);fill(accent);round(6,-20,30,20,8);fill(accent);ctx.beginPath();ctx.moveTo(-8,-14);ctx.lineTo(8,-14);stroke(accent,4);arc(4,10,18,.2,.75,accent,5);break;
  case 'wink':face();ellipse(-16,-10,5,8);fill(accent);arc(16,-8,8,1.1,1.9,accent,5);arc(0,4,24,.15,.85,accent,6);break;
  case 'sad':face();eyes();arc(0,34,20,1.2,1.8,accent,6);ctx.beginPath();ctx.moveTo(-18,0);ctx.quadraticCurveTo(-12,12,-18,16);ctx.quadraticCurveTo(-24,12,-18,0);fill('#5ac8fa');break;
  case 'angry':face();ctx.beginPath();ctx.moveTo(-30,-26);ctx.lineTo(-8,-14);ctx.moveTo(30,-26);ctx.lineTo(8,-14);stroke(accent,6);ellipse(-16,-4,5,7);fill(accent);ellipse(16,-4,5,7);fill(accent);arc(0,36,20,1.2,1.8,accent,6);break;
  case 'arrow':poly([[-44,-12],[10,-12],[10,-30],[46,0],[10,30],[10,12],[-44,12]]);fill(color);stroke(accent,4);break;
  case 'check':circle(0,0,44);fill(color);ctx.beginPath();ctx.moveTo(-20,2);ctx.lineTo(-6,16);ctx.lineTo(22,-14);stroke(accent,10);break;
  case 'cross':circle(0,0,44);fill(color);ctx.beginPath();ctx.moveTo(-16,-16);ctx.lineTo(16,16);ctx.moveTo(16,-16);ctx.lineTo(-16,16);stroke(accent,10);break;
  case 'pin':ctx.beginPath();ctx.moveTo(0,46);ctx.bezierCurveTo(-10,24,-36,6,-36,-14);ctx.arc(0,-14,36,Math.PI,0);ctx.bezierCurveTo(36,6,10,24,0,46);ctx.closePath();fill(color);circle(0,-14,13);fill(accent);break;
  case 'play':round(-46,-32,92,64,18);fill(color);poly([[-12,-16],[-12,16],[18,0]]);fill(accent);break;
  case 'speech':round(-46,-38,92,62,16);fill(color);poly([[-18,22],[-30,44],[-2,22]]);fill(color);round(-46,-38,92,62,16);stroke(accent,3);
   if(text.trim())label(text,accent,16,80);else for(const x of [-16,0,16]){circle(x,-7,5);fill(accent);}break;
  case 'new':star(16,48,40);fill(color);ctx.save();ctx.rotate(-.2);ctx.fillStyle=accent;ctx.font='900 24px "Arial Black", Arial, sans-serif';ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('NEW',0,1);ctx.restore();break;
  default:circle(0,0,40);fill(color);
 }
 ctx.restore();
}
