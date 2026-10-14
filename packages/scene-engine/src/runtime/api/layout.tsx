import React,{useLayoutEffect,useRef,useState} from 'react';
import {AbsoluteFill,useVideoConfig} from 'remotion';
import {track} from '../pending';
import {post} from '../bridge';

/** A setting given to an engine component that it does not use comes back to the agent as a scene error with what the
 * component does take, instead of being dropped without a word (captions were reported white three times while FitText
 * ignored their color prop). Each is reported once per document. */
const reported=new Set<string>();
export function reportIgnored(component:string,props:string[],takes:string){
 const fresh=props.filter(p=>!reported.has(component+':'+p));if(!fresh.length||typeof parent==='undefined'||parent===window)return;
 for(const p of fresh)reported.add(component+':'+p);
 post({error:`${component} ignores ${fresh.map(p=>JSON.stringify(p)).join(', ')}: it takes ${takes}. Put any other CSS in style.`});
}

/** Bundled font families (Open Font License), available offline in every scene. */
export const fonts={inter:'Inter',roboto:'Roboto',montserrat:'Montserrat',poppins:'Poppins',oswald:'Oswald',bebasNeue:'Bebas Neue',playfairDisplay:'Playfair Display',lora:'Lora',spaceGrotesk:'Space Grotesk',jetbrainsMono:'JetBrains Mono',pressStart2P:'Press Start 2P'} as const;
/** Ensures a font face is loaded before the frame is captured; returns the family name for CSS. */
export function loadFont(family:string,weight:number|string=400){track(document.fonts.load(`${weight} 32px "${family}"`).catch(()=>[]));return family;}

let fontsVersion=0;const listeners=new Set<()=>void>();
if(typeof document!=='undefined')document.fonts?.addEventListener?.('loadingdone',()=>{fontsVersion++;listeners.forEach(l=>l());});

/** How the text itself looks, given straight to FitText (also accepted inside style). */
type TextLook={color?:string;textShadow?:string;WebkitTextStroke?:string;letterSpacing?:number|string;textTransform?:React.CSSProperties['textTransform'];fontStyle?:string;textDecoration?:string};
type FitProps={children:React.ReactNode;maxFontSize?:number;minFontSize?:number;lineHeight?:number;fontFamily?:string;fontWeight?:number|string;align?:'left'|'center'|'right';verticalAlign?:'top'|'center'|'bottom';style?:React.CSSProperties;className?:string}&TextLook;
const fitTakes='fontFamily, fontWeight, maxFontSize, minFontSize, lineHeight, align, verticalAlign, color, textShadow, WebkitTextStroke, letterSpacing, textTransform, fontStyle, textDecoration, style and className';
/** Text that fills its parent box at the largest size that fits, wrapping as needed. It cannot overflow. */
export function FitText({children,maxFontSize=240,minFontSize=6,lineHeight=1.1,fontFamily='Inter',fontWeight=700,align='center',verticalAlign='center',style,className,color,textShadow,WebkitTextStroke,letterSpacing,textTransform,fontStyle,textDecoration,...rest}:FitProps&Record<string,unknown>){
 const ignored=Object.keys(rest);useLayoutEffect(()=>{if(ignored.length)reportIgnored('FitText',ignored,fitTakes);},[ignored.join(',')]);
 const look=Object.fromEntries(Object.entries({color,textShadow,WebkitTextStroke,letterSpacing,textTransform,fontStyle,textDecoration}).filter(([,v])=>v!==undefined));
 const outer=useRef<HTMLDivElement>(null),inner=useRef<HTMLDivElement>(null),[,setVersion]=useState(0);
 useLayoutEffect(()=>{const update=()=>setVersion(fontsVersion);listeners.add(update);loadFont(fontFamily,fontWeight);return()=>{listeners.delete(update);};},[fontFamily,fontWeight]);
 useLayoutEffect(()=>{
  const box=outer.current,text=inner.current;if(!box||!text)return;
  const fits=(size:number)=>{text.style.fontSize=size+'px';return text.scrollWidth<=box.clientWidth+.5&&text.scrollHeight<=box.clientHeight+.5;};
  let low=minFontSize,high=maxFontSize;if(fits(high)){return;}
  for(let i=0;i<18&&high-low>.25;i++){const mid=(low+high)/2;if(fits(mid))low=mid;else high=mid;}
  fits(low);
 });
 const justify=align==='left'?'flex-start':align==='right'?'flex-end':'center',items=verticalAlign==='top'?'flex-start':verticalAlign==='bottom'?'flex-end':'center';
 return <div ref={outer} className={className} style={{width:'100%',height:'100%',display:'flex',justifyContent:justify,alignItems:items,overflow:'hidden',...style}}><div ref={inner} style={{fontFamily:`"${fontFamily}", sans-serif`,fontWeight,lineHeight,textAlign:align,overflowWrap:'break-word',maxWidth:'100%',whiteSpace:'pre-wrap',...look}}>{children}</div></div>;
}

/** A full-frame container inset from the edges (5% by default), so content stays clear of crops and overlays. */
export function SafeArea({children,inset=.05,style,className,...rest}:{children?:React.ReactNode;inset?:number;style?:React.CSSProperties;className?:string}&Record<string,unknown>){
 const ignored=Object.keys(rest);useLayoutEffect(()=>{if(ignored.length)reportIgnored('SafeArea',ignored,'inset, style and className');},[ignored.join(',')]);
 const {width,height}=useVideoConfig();
 return <AbsoluteFill className={className} style={{padding:`${Math.round(height*inset)}px ${Math.round(width*inset)}px`,display:'flex',flexDirection:'column',...style}}>{children}</AbsoluteFill>;
}
