import React,{useEffect,useRef,useState} from 'react';
import {Diamond} from 'lucide-react';

/** The properties panel's controls, after OpenCut's property fields: a label, a slider and its value (type over it to set it
 * exactly), a colour, a choice. Every control shows its change live (live) and makes one undoable change when it is let
 * go, or a moment after the last keystroke (commit). */
export type Live<T>={live:(value:T)=>void;commit:(value:T)=>void};
/** A property's keyframe state at the playhead: whether it is animated, whether a keyframe sits here, and the toggle. */
export type KeyState={animated:boolean;here:boolean;toggle:()=>void};

export function Section({title,children,aside}:{title:string;children:React.ReactNode;aside?:React.ReactNode}){
 return <section className="prop-section"><h3><span>{title}</span>{aside}</h3>{children}</section>;
}

const round=(v:number,step:number)=>{const digits=Math.max(0,-Math.floor(Math.log10(step)));return Number(v.toFixed(digits));};
export function NumberField(p:{label:string;value:number;min:number;max:number;step:number;unit?:string;scale?:number;disabled?:boolean;keyframe?:KeyState}&Live<number>){
 const scale=p.scale??1,[text,setText]=useState<string|null>(null),last=useRef(p.value),dragging=useRef(false),timer=useRef<number>(undefined);
 useEffect(()=>()=>window.clearTimeout(timer.current),[]);
 const shown=round(p.value*scale,p.step*scale);
 const commitSoon=(v:number)=>{window.clearTimeout(timer.current);timer.current=window.setTimeout(()=>p.commit(v),450);};
 const set=(v:number,now:boolean)=>{const value=Math.max(p.min,Math.min(p.max,v));last.current=value;p.live(value);if(now){window.clearTimeout(timer.current);p.commit(value);}else if(!dragging.current)commitSoon(value);};
 const fill=(p.value-p.min)/Math.max(1e-9,p.max-p.min)*100;
 return <div className={'prop-field number'+(p.keyframe?.animated?' animated':'')}>
  <label><span>{p.label}</span>
   <input type="text" inputMode="decimal" aria-label={p.label+' value'} disabled={p.disabled} value={text??String(shown)+(p.unit??'')} onFocus={e=>{setText(String(shown));requestAnimationFrame(()=>e.target.select());}}
    onChange={e=>setText(e.target.value)} onBlur={()=>{const v=parseFloat(text??'');setText(null);if(Number.isFinite(v)&&v!==shown)set(v/scale,true);}} onKeyDown={e=>{if(e.key==='Enter')(e.target as HTMLInputElement).blur();if(e.key==='Escape'){setText(null);(e.target as HTMLInputElement).blur();}}}/>
  </label>
  <div className="prop-slider">
   <input type="range" aria-label={p.label} min={p.min} max={p.max} step={p.step} value={p.value} disabled={p.disabled} style={{'--fill':fill+'%'} as React.CSSProperties}
    onPointerDown={()=>{dragging.current=true;}} onPointerUp={()=>{dragging.current=false;p.commit(last.current);}} onChange={e=>set(Number(e.target.value),false)}/>
   {p.keyframe&&<button type="button" className={'keyframe-toggle'+(p.keyframe.here?' here':'')} aria-pressed={p.keyframe.here} disabled={p.disabled} aria-label={(p.keyframe.here?'Remove keyframe for ':'Add keyframe for ')+p.label} title={p.keyframe.here?'Remove the keyframe here':'Add a keyframe at the playhead'} onClick={p.keyframe.toggle}><Diamond size={11} fill={p.keyframe.here?'currentColor':'none'}/></button>}
  </div>
 </div>;
}

export function ChoiceField<T extends string>(p:{label:string;value:T;options:readonly {id:T;name:string}[];disabled?:boolean;onChange:(value:T)=>void}){
 return <label className="prop-field choice"><span>{p.label}</span><select value={p.value} disabled={p.disabled} onChange={e=>p.onChange(e.target.value as T)}>{p.options.map(o=><option key={o.id} value={o.id}>{o.name}</option>)}</select></label>;
}

/** A row of words to pick one from, for a handful of choices (fit or fill, left or right). */
export function Segmented<T extends string>(p:{label:string;value:T;options:readonly {id:T;name:string}[];disabled?:boolean;onChange:(value:T)=>void}){
 return <div className="prop-field segmented"><span>{p.label}</span><div role="radiogroup" aria-label={p.label}>{p.options.map(o=><button key={o.id} type="button" role="radio" aria-checked={p.value===o.id} disabled={p.disabled} onClick={()=>p.onChange(o.id)}>{o.name}</button>)}</div></div>;
}

export function ToggleField(p:{label:string;value:boolean;disabled?:boolean;onChange:(value:boolean)=>void}){
 return <label className="prop-field toggle"><span>{p.label}</span><input type="checkbox" role="switch" checked={p.value} disabled={p.disabled} onChange={e=>p.onChange(e.target.checked)}/></label>;
}

const hex=(value:string)=>/^#[0-9a-f]{6}/i.test(value)?value.slice(0,7):'#ffffff';
/** A colour, with how opaque it is kept from the value it had (#rrggbbaa). */
export function ColorField(p:{label:string;value:string;disabled?:boolean;allowNone?:boolean}&Live<string|undefined>){
 const timer=useRef<number>(undefined),alpha=/^#[0-9a-f]{8}$/i.test(p.value)?p.value.slice(7):'';
 useEffect(()=>()=>window.clearTimeout(timer.current),[]);
 const none=p.allowNone&&(!p.value||p.value==='transparent');
 const change=(v:string|undefined)=>{p.live(v);window.clearTimeout(timer.current);timer.current=window.setTimeout(()=>p.commit(v),400);};
 return <label className="prop-field color"><span>{p.label}</span><span className="color-pick">
  {p.allowNone&&<button type="button" className={'color-none'+(none?' on':'')} aria-pressed={!!none} disabled={p.disabled} onClick={e=>{e.preventDefault();p.live(undefined);p.commit(undefined);}}>None</button>}
  <input type="color" aria-label={p.label} value={none?'#000000':hex(p.value)} disabled={p.disabled} onChange={e=>change(e.target.value+alpha)}/></span></label>;
}

export function TextField(p:{label:string;value:string;multiline?:boolean;disabled?:boolean;bare?:boolean}&Live<string>){
 const [text,setText]=useState(p.value),timer=useRef<number>(undefined),editing=useRef(false);
 useEffect(()=>{if(!editing.current)setText(p.value);},[p.value]);
 useEffect(()=>()=>window.clearTimeout(timer.current),[]);
 const change=(v:string)=>{setText(v);p.live(v);window.clearTimeout(timer.current);timer.current=window.setTimeout(()=>p.commit(v),600);};
 const props={'aria-label':p.label,value:text,disabled:p.disabled,onFocus:()=>{editing.current=true;},onBlur:()=>{editing.current=false;window.clearTimeout(timer.current);if(text!==p.value)p.commit(text);},onChange:(e:React.ChangeEvent<HTMLInputElement|HTMLTextAreaElement>)=>change(e.target.value)};
 return <label className={'prop-field text'+(p.bare?' bare':'')}>{!p.bare&&<span>{p.label}</span>}{p.multiline?<textarea rows={3} {...props}/>:<input type="text" {...props}/>}</label>;
}
