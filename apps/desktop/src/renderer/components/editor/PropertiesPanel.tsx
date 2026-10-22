import React,{useMemo} from 'react';
import {Film,Type,Music2,AudioLines,Sparkles,SlidersHorizontal,Layers,Captions as CaptionsIcon,Settings2,MousePointerClick,ChevronsRight,Smile} from 'lucide-react';
import {apply,resolve,keyframeValues,clipClock,itemClock,canvasPresets,canvasRatio,projectAnchor,KEYFRAME_PROPS,TRANSITIONS,DIRECTIONS,transitionInfo,EFFECTS,effectInfo,FILTERS,TEXT_STYLES,textStyle,CAPTION_STYLES,captionStyle,captionParamsFor,STICKERS,stickerInfo,FONTS,TEXT_ANIMATIONS,OUT_ANIMATIONS,LOOP_ANIMATIONS,type Direction,type Keyframe,type KeyframeProp,type Op,type TimelineDocument,type ResolvedClip,type ResolvedItem} from '@dream/timeline';
import type {ProjectState} from '@dream/project-db';
import {itemLook,reason,ensureDuration,setKeyframe,transitionOps,transitionClip} from '../../manual/model';
export {setKeyframe};
import {Section,NumberField,ChoiceField,Segmented,ToggleField,ColorField,TextField,type Live,type KeyState} from './fields';

/** The properties of what is selected, after OpenCut's properties panel: transform, adjustments, speed, sound, the
 * transition into a clip, and each kind's own settings (text, effect amount, music level). With nothing selected it shows
 * the project's settings. Every value shows live in the preview while it changes and is one undoable change when let go.
 * Animatable values have a diamond: it sets a keyframe at the playhead, and once a value is animated, changing it sets the
 * keyframe at the playhead, as in CapCut. */
type Props={project:ProjectState;timeline:TimelineDocument;frame:number;selected:string[];locked:boolean;lockedReason:string;
 onApply:(ops:Op[],label:string,version?:string)=>Promise<unknown>;onPreview:(t:TimelineDocument|null)=>void;onError:(text:string)=>void};

const clock=(sec:number)=>`${Math.floor(sec/60)}:${(sec%60).toFixed(1).padStart(4,'0')}`;
const half=(fps:number)=>.5/fps;
export function PropertiesPanel(p:Props){
 const base=p.project.timeline,f=p.project.footage,t=p.timeline,fps=t.settings.fps,time=p.frame/fps;
 const shown=useMemo(()=>resolve(t,f),[t,f]),resolvedBase=useMemo(()=>resolve(base,f),[base,f]);
 const disabled=p.locked;
 // Live: the preview plays the edit with the change; commit: one undoable change against the version it was made on.
 const live=(ops:Op[])=>{try{if(ops.length)p.onPreview(apply(base,ops,f));}catch{}};
 const commit=(ops:Op[],label:string)=>{if(p.locked){p.onPreview(null);p.onError(p.lockedReason);return;}if(!ops.length){p.onPreview(null);return;}
  void Promise.resolve(p.onApply(ops,label,p.project.versionId)).catch(error=>p.onError((error as Error).message)).finally(()=>p.onPreview(null));};
 const edit=<T,>(label:string,make:(value:T)=>Op[]):Live<T>=>({live:v=>{try{live(make(v));}catch{}},commit:v=>{try{commit(make(v),label);}catch(error){p.onPreview(null);p.onError((error as Error).message);}}});
 const now=(ops:Op[],label:string)=>commit(ops,label);

 const id=p.selected.length===1?p.selected[0]:undefined;
 if(p.selected.length>1)return <aside className="editor-properties" aria-label="Properties"><div className="prop-empty"><MousePointerClick size={18}/><p>{p.selected.length} items selected</p><small>Select one to change its properties. Delete, split and duplicate work on all of them.</small></div></aside>;

 const cutInto=id?transitionClip(id):undefined,clip=id&&!cutInto?shown.clips.find(c=>c.id===id):undefined,item=id?shown.items.find(i=>i.id===id):undefined,music=id?shown.music.find(m=>m.id===id):undefined,word=id?shown.words.find(w=>w.id===id):undefined;
 let body:React.ReactNode,title='Project',icon=<Settings2 size={14}/>;
 if(cutInto){const into=shown.clips.find(c=>c.id===cutInto);title=transitionInfo(into?.transitionIn?.type??'')?.name??'Transition';icon=<ChevronsRight size={14}/>;
  body=<><p className="prop-note">Into {f.assets.find(a=>a.id===into?.assetId)?.filename??'the next clip'} at {clock(into?.start??0)}</p><TransitionFields {...{p,base,clipId:cutInto,edit,now,disabled}}/></>;}
 else if(clip){const asset=f.assets.find(a=>a.id===clip.assetId);title=asset?.filename??'Clip';icon=<Film size={14}/>;body=<ClipProperties {...{p,clip,base,resolvedBase,edit,now,time,fps,disabled}}/>;}
 else if(item){const look=itemLook(item,f);title=look==='text'?'Text':look==='sticker'?stickerInfo(item.params.sticker)?.name??'Sticker':look==='effect'?effectInfo(item.component)?.name??item.component.replaceAll('_',' '):look==='filter'?'Filter':look==='sfx'?'Sound effect':f.assets.find(a=>a.id===item.source?.assetId)?.filename??'Overlay';
  icon=look==='sticker'?<Smile size={14}/>:look==='text'?<Type size={14}/>:look==='effect'?<Sparkles size={14}/>:look==='filter'?<SlidersHorizontal size={14}/>:look==='sfx'?<AudioLines size={14}/>:<Layers size={14}/>;
  body=<ItemProperties {...{p,item,look,base,edit,now,time,fps,disabled}}/>;}
 else if(music){title=f.assets.find(a=>a.id===music.assetId)?.filename??'Music';icon=<Music2 size={14}/>;const m=base.music.find(x=>x.id===music.id)!;
  const set=(changes:Partial<typeof m>)=>[{type:'update_music' as const,musicId:m.id,changes,reason}];
  body=<><Section title="Sound">
   <NumberField label="Volume" value={music.gainDb} min={-40} max={12} step={.5} unit=" dB" disabled={disabled} {...edit<number>('Change music volume',v=>set({gainDb:v}))}/>
   <NumberField label="Fade in" value={music.fadeInSec} min={0} max={10} step={.1} unit="s" disabled={disabled} {...edit<number>('Change music fade',v=>set({fadeInSec:v}))}/>
   <NumberField label="Fade out" value={music.fadeOutSec} min={0} max={10} step={.1} unit="s" disabled={disabled} {...edit<number>('Change music fade',v=>set({fadeOutSec:v}))}/>
   <NumberField label="Lower under speech" value={music.duckUnderSpeechDb} min={0} max={30} step={1} unit=" dB" disabled={disabled} {...edit<number>('Change ducking',v=>set({duckUnderSpeechDb:v}))}/>
  </Section><Section title="Timing"><NumberField label="Starts at" value={music.timelineStart} min={0} max={Math.max(60,shown.durationSec+30)} step={1/fps} unit="s" disabled={disabled} {...edit<number>('Move music',v=>set({start:projectAnchor(Math.round(v*fps)/fps)}))}/></Section></>;}
 else if(word){title='Caption';icon=<CaptionsIcon size={14}/>;const override=base.captions?.overrides.find(o=>o.wordId===word.wordId&&o.clipId===word.clipId);
  const set=(changes:{text?:string;emphasis?:boolean;hidden?:boolean})=>[{type:'update_caption_overrides' as const,overrides:[{wordId:word.wordId,clipId:word.clipId,...override,...changes}],reason}];
  body=<><Section title="Word"><TextField label="Text" value={word.text} disabled={disabled} {...edit<string>('Change caption word',v=>set({text:v}))}/>
   <ToggleField label="Emphasis" value={word.emphasis} disabled={disabled} onChange={v=>now(set({emphasis:v}),'Change caption emphasis')}/>
   <button type="button" className="prop-link" disabled={disabled} onClick={()=>now(set({hidden:true}),'Hide caption word')}>Hide this word</button></Section><CaptionSettings {...{p,base,edit,now,disabled}}/></>;}
 else body=<ProjectProperties {...{p,base,edit,now,disabled,duration:shown.durationSec}}/>;
 return <aside className="editor-properties" aria-label="Properties"><header className="prop-header">{icon}<strong title={title}>{title}</strong></header><div className="prop-scroll">{body}</div></aside>;
}

type Edit=<T,>(label:string,make:(value:T)=>Op[])=>Live<T>;
type Common={p:Props;base:TimelineDocument;edit:Edit;now:(ops:Op[],label:string)=>void;time:number;fps:number;disabled:boolean};

/** Animatable values: the value at the playhead (keyframed when animated), the change that sets it, and its diamond. */
function animatable(o:{keys:Keyframe[]|undefined;sec:number;fps:number;id:string;setStatic:(prop:KeyframeProp,value:number)=>Op[];now:Common['now'];staticValue:(prop:KeyframeProp)=>number}){
 const values=keyframeValues(o.keys,o.sec);
 const animated=(prop:KeyframeProp)=>(o.keys??[]).some(k=>k[prop]!==undefined);
 const value=(prop:KeyframeProp)=>values[prop]??o.staticValue(prop);
 const make=(prop:KeyframeProp,v:number):Op[]=>animated(prop)?[{type:'set_keyframes',id:o.id,keyframes:setKeyframe(o.keys,o.sec,prop,v,o.fps),reason}]:o.setStatic(prop,v);
 const here=(prop:KeyframeProp)=>(o.keys??[]).some(k=>k[prop]!==undefined&&Math.abs(k.sec-o.sec)<=half(o.fps));
 const keyframe=(prop:KeyframeProp,label:string):KeyState=>({animated:animated(prop),here:here(prop),toggle:()=>o.now([{type:'set_keyframes',id:o.id,keyframes:setKeyframe(o.keys,o.sec,prop,here(prop)?undefined:value(prop),o.fps),reason}],(here(prop)?'Remove keyframe: ':'Add keyframe: ')+label)});
 return{value,make,keyframe};
}

function ClipProperties({p,clip,base,resolvedBase,edit,now,time,fps,disabled}:Common&{clip:ResolvedClip;resolvedBase:ReturnType<typeof resolve>}){
 const f=p.project.footage,asset=f.assets.find(a=>a.id===clip.assetId),raw=base.spine.find(c=>c.id===clip.id),placed=resolvedBase.clips.find(c=>c.id===clip.id);
 if(!raw||!placed)return null;
 const framing=raw.framing??{mode:'fit' as const,scale:1,x:.5,y:.5},shownFraming=clip.framing??framing;
 const at=Math.max(placed.start,Math.min(placed.end-1/fps,time)),sec=clipClock(placed,at);
 const a=animatable({keys:raw.keyframes,sec,fps,id:raw.id,now,staticValue:prop=>prop==='x'||prop==='y'?.5:Number((shownFraming as any)[prop]??(prop==='scale'||prop==='opacity'||prop==='contrast'||prop==='saturation'?1:0)),
  // Position has no still value on the main track: one keyframe holds it in place.
  setStatic:(prop,v)=>prop==='x'||prop==='y'?[{type:'set_keyframes',id:raw.id,keyframes:setKeyframe(raw.keyframes,sec,prop,v,fps),reason}]:[{type:'set_framing',clipId:raw.id,framing:{...framing,[prop]:v},reason}]});
 const shownKeys=keyframeValues(clip.keyframes,clipClock(clip,Math.max(clip.start,Math.min(clip.end-1/fps,time))));
 const value=(prop:KeyframeProp)=>shownKeys[prop]??a.value(prop);
 const num=(prop:KeyframeProp,label:string,min:number,max:number,step:number,o:{unit?:string;scale?:number;offset?:number}={})=><NumberField key={prop} label={label} value={value(prop)-(o.offset??0)} min={min} max={max} step={step} unit={o.unit} scale={o.scale} disabled={disabled} keyframe={a.keyframe(prop,label)} {...edit<number>('Change '+label.toLowerCase(),v=>a.make(prop,v+(o.offset??0)))}/>;
 const index=base.spine.findIndex(c=>c.id===raw.id),video=asset?.kind==='video'&&!asset.scene;
 return <>
  <p className="prop-note">{asset?.kind==='image'?'Photo':asset?.scene?'Motion graphic':'Video'} · {clock(clip.start)}–{clock(clip.end)}{video?` · source ${clock(raw.srcIn)}–${clock(raw.srcOut)}`:''}</p>
  <Section title="Transform">{num('scale','Scale',.1,4,.01,{unit:'%',scale:100})}{num('x','Position X',-.5,.5,.005,{unit:'%',scale:100,offset:.5})}{num('y','Position Y',-.5,.5,.005,{unit:'%',scale:100,offset:.5})}{num('rotation','Rotation',-180,180,1,{unit:'°'})}{num('opacity','Opacity',0,1,.01,{unit:'%',scale:100})}
   <ToggleField label="Flip horizontally" value={!!shownFraming.flipX} disabled={disabled} onChange={v=>now([{type:'set_framing',clipId:raw.id,framing:{...framing,flipX:v},reason}],'Flip clip')}/>
   <ToggleField label="Flip vertically" value={!!shownFraming.flipY} disabled={disabled} onChange={v=>now([{type:'set_framing',clipId:raw.id,framing:{...framing,flipY:v},reason}],'Flip clip')}/>
   <p className="prop-hint">The main track always fills the frame: it moves only as far as its zoom allows.</p></Section>
  <Section title="Filter"><ChoiceField label="Filter" value={shownFraming.filter??''} disabled={disabled} options={FILTER_OPTIONS} onChange={v=>now([{type:'set_framing',clipId:raw.id,framing:{...framing,filter:v||undefined,filterIntensity:v?framing.filterIntensity??1:undefined},reason}],v?'Add filter':'Remove filter')}/>
   {shownFraming.filter&&<NumberField label="Intensity" value={shownFraming.filterIntensity??1} min={0} max={1} step={.01} unit="%" scale={100} disabled={disabled} {...edit<number>('Change filter intensity',v=>[{type:'set_framing',clipId:raw.id,framing:{...framing,filterIntensity:v},reason}])}/>}</Section>
  <Section title="Adjust">{num('exposure','Exposure',-2,2,.05)}{num('contrast','Contrast',0,2,.01,{unit:'%',scale:100})}{num('saturation','Saturation',0,2,.01,{unit:'%',scale:100})}{num('temperature','Temperature',-1,1,.01,{scale:100})}
   <NumberField label="Tint" value={shownFraming.tint??0} min={-1} max={1} step={.01} scale={100} disabled={disabled} {...edit<number>('Change tint',v=>[{type:'set_framing',clipId:raw.id,framing:{...framing,tint:v},reason}])}/>
   <NumberField label="Fade" value={shownFraming.fade??0} min={0} max={1} step={.01} unit="%" scale={100} disabled={disabled} {...edit<number>('Change fade',v=>[{type:'set_framing',clipId:raw.id,framing:{...framing,fade:v},reason}])}/></Section>
  {asset?.kind==='image'?<Section title="Duration"><NumberField label="Duration" value={clip.holdSec??clip.end-clip.start} min={.2} max={120} step={.1} unit="s" disabled={disabled} {...edit<number>('Change duration',v=>[{type:'set_clip_hold',clipId:raw.id,holdSec:Math.max(1/fps,Math.round(v*fps)/fps),reason}])}/></Section>
   :<Section title="Speed"><NumberField label="Speed" value={clip.speed} min={.25} max={4} step={.05} unit="×" disabled={disabled} {...edit<number>('Change speed',v=>[{type:'set_speed',clipId:raw.id,speed:v,reason}])}/></Section>}
  {asset?.hasAudio&&<Section title="Sound">
   <NumberField label="Volume" value={clip.audio.gainDb} min={-40} max={12} step={.5} unit=" dB" disabled={disabled||clip.audio.mute} {...edit<number>('Change clip volume',v=>[{type:'set_clip_audio',clipId:raw.id,audio:{gainDb:v},reason}])}/>
   <ToggleField label="Mute" value={clip.audio.mute} disabled={disabled} onChange={v=>now([{type:'set_clip_audio',clipId:raw.id,audio:{mute:v},reason}],v?'Mute clip':'Unmute clip')}/>
   <NumberField label="Fade in" value={clip.audio.fadeInSec} min={0} max={5} step={.05} unit="s" disabled={disabled} {...edit<number>('Change clip fade',v=>[{type:'set_clip_audio',clipId:raw.id,audio:{fadeInSec:v},reason}])}/>
   <NumberField label="Fade out" value={clip.audio.fadeOutSec} min={0} max={5} step={.05} unit="s" disabled={disabled} {...edit<number>('Change clip fade',v=>[{type:'set_clip_audio',clipId:raw.id,audio:{fadeOutSec:v},reason}])}/></Section>}
  {index>0&&<TransitionFields {...{p,base,clipId:raw.id,edit,now,disabled}}/>}
 </>;
}

/** A cut's transition: which one, how long, and which way it goes; None makes it a cut again. Changing the length trims
 * the clips when they need more footage past the cut, as adding it does. */
function TransitionFields({p,base,clipId,edit,now,disabled}:Omit<Common,'time'|'fps'>&{clipId:string}){
 const f=p.project.footage,shown=p.timeline.spine.find(c=>c.id===clipId)?.transitionIn,current=base.spine.find(c=>c.id===clipId)?.transitionIn,info=transitionInfo(shown?.type??'');
 const make=(type:string,durationSec?:number,direction?:Direction,intensity?:number)=>transitionOps(base,f,clipId,type,durationSec,direction,intensity);
 return <Section title="Transition">
  <ChoiceField label="Type" value={shown?.type??'cut'} disabled={disabled} options={[{id:'cut',name:'None (cut)'},...TRANSITIONS.map(t=>({id:t.id,name:t.name}))]} onChange={type=>{try{now(make(type,type==='cut'?undefined:current&&current.type!=='cut'?current.durationSec:undefined),type==='cut'?'Remove transition':'Change transition');}catch(error){p.onError((error as Error).message);}}}/>
  {shown&&shown.type!=='cut'&&<NumberField label="Duration" value={shown.durationSec} min={.1} max={2} step={.05} unit="s" disabled={disabled} {...edit<number>('Change transition length',v=>make(shown.type,v,shown.direction))}/>}
  {shown&&info?.directional&&<Segmented label="Direction" value={shown.direction??'left'} disabled={disabled} options={DIRECTIONS.map(d=>({id:d,name:d[0].toUpperCase()+d.slice(1)}))} onChange={d=>{try{now(make(shown.type,shown.durationSec,d),'Change transition direction');}catch(error){p.onError((error as Error).message);}}}/>}
  {shown&&info?.strength&&<NumberField label="Strength" value={Math.round((shown.intensity??1)*100)} min={0} max={100} step={1} unit="%" disabled={disabled} {...edit<number>('Change transition strength',v=>make(shown.type,shown.durationSec,shown.direction,v/100))}/>}
  {info&&<p className="prop-hint">{info.about}</p>}
 </Section>;
}

function ItemProperties({p,item,look,base,edit,now,time,fps,disabled}:Common&{item:ResolvedItem;look:ReturnType<typeof itemLook>}){
 const raw=base.attached.find(i=>i.id===item.id),f=p.project.footage;if(!raw)return null;
 const params=raw.params,shownParams=item.params as Record<string,unknown>,setParams=(changes:Record<string,unknown>):Op[]=>[{type:'update_item',itemId:raw.id,changes:{params:{...params,...changes}},reason}];
 const at=Math.max(item.timelineStart,Math.min(item.timelineEnd-1/fps,time)),sec=itemClock({timelineStart:resolve(base,f).items.find(i=>i.id===raw.id)?.timelineStart??item.timelineStart,source:raw.source},at);
 const defaults:Record<string,number>={x:.5,y:look==='text'&&raw.component!=='title_card'?.8:.5,scale:1,rotation:0,opacity:1,exposure:0,contrast:1,saturation:1,temperature:0};
 const a=animatable({keys:raw.keyframes,sec,fps,id:raw.id,now,staticValue:prop=>Number(shownParams[prop]??defaults[prop]),setStatic:(prop,v)=>setParams({[prop]:v})});
 const shownKeys=keyframeValues(item.keyframes,itemClock(item,at)),value=(prop:KeyframeProp)=>shownKeys[prop]??a.value(prop);
 const num=(prop:KeyframeProp,label:string,min:number,max:number,step:number,o:{unit?:string;scale?:number;offset?:number}={})=><NumberField key={prop} label={label} value={value(prop)-(o.offset??0)} min={min} max={max} step={step} unit={o.unit} scale={o.scale} disabled={disabled} keyframe={a.keyframe(prop,label)} {...edit<number>('Change '+label.toLowerCase(),v=>a.make(prop,v+(o.offset??0)))}/>;
 const param=(key:string,label:string,fallback:number,min:number,max:number,step:number,o:{unit?:string;scale?:number}={})=><NumberField key={key} label={label} value={Number(shownParams[key]??fallback)} min={min} max={max} step={step} unit={o.unit} scale={o.scale} disabled={disabled} {...edit<number>('Change '+label.toLowerCase(),v=>setParams({[key]:v}))}/>;
 const transform=<Section title="Transform">{num('x','Position X',-.5,.5,.005,{unit:'%',scale:100,offset:.5})}{num('y','Position Y',-.5,.5,.005,{unit:'%',scale:100,offset:.5})}{num('scale','Scale',.05,4,.01,{unit:'%',scale:100})}{num('rotation','Rotation',-180,180,1,{unit:'°'})}{num('opacity','Opacity',0,1,.01,{unit:'%',scale:100})}</Section>;
 const filter=<Section title="Filter"><ChoiceField label="Filter" value={String(shownParams.filter??'')} disabled={disabled} options={FILTER_OPTIONS} onChange={v=>now(setParams({filter:v||undefined,filterIntensity:v?Number(params.filterIntensity??1):undefined}),v?'Add filter':'Remove filter')}/>
  {typeof shownParams.filter==='string'&&param('filterIntensity','Intensity',1,0,1,.01,{unit:'%',scale:100})}</Section>;
 const adjust=<Section title="Adjust">{num('exposure','Exposure',-2,2,.05)}{num('contrast','Contrast',0,2,.01,{unit:'%',scale:100})}{num('saturation','Saturation',0,2,.01,{unit:'%',scale:100})}{num('temperature','Temperature',-1,1,.01,{scale:100})}</Section>;
 const timing=<Section title="Timing">
  <NumberField label="Starts at" value={item.timelineStart} min={0} max={Math.max(60,item.timelineEnd+30)} step={1/fps} unit="s" disabled={disabled} {...edit<number>('Move element',v=>[{type:'update_item',itemId:raw.id,clearEnd:true,changes:{start:projectAnchor(Math.round(v*fps)/fps),end:undefined,durationSec:item.timelineEnd-item.timelineStart},reason}])}/>
  <NumberField label="Duration" value={item.timelineEnd-item.timelineStart} min={1/fps} max={600} step={1/fps} unit="s" disabled={disabled} {...edit<number>('Change element length',v=>[{type:'update_item',itemId:raw.id,clearEnd:true,changes:{start:projectAnchor(item.timelineStart),end:undefined,durationSec:Math.max(1/fps,Math.round(v*fps)/fps),...(raw.source&&f.assets.find(x=>x.id===raw.source!.assetId)?.kind!=='image'?{source:{...raw.source,srcOut:raw.source.srcIn+Math.max(1/fps,v)}}:{})},reason},...ensureDuration(base,0)])}/></Section>;
 if(look==='text'){
  // A styled text shows its style's values under its own; changing one makes it the text's own.
  const component=raw.component,style=textStyle(params.style),eff={...(style?.params??{}),...shownParams} as Record<string,any>;
  const value=(key:string,fallback:number)=>Number(eff[key]??fallback),number=(key:string,label:string,fallback:number,min:number,max:number,step:number,o:{unit?:string;scale?:number}={})=><NumberField key={key} label={label} value={value(key,fallback)} min={min} max={max} step={step} unit={o.unit} scale={o.scale} disabled={disabled} {...edit<number>('Change '+label.toLowerCase(),v=>setParams({[key]:v}))}/>;
  const colour=(key:string,label:string,fallback:string,none=false)=><ColorField key={key} label={label} allowNone={none} value={String(eff[key]??fallback)} disabled={disabled} {...edit<string|undefined>('Change '+label.toLowerCase(),v=>setParams({[key]:v??(none?'':fallback)}))}/>;
  const choice=(key:string,label:string,options:readonly {id:string;name:string}[],fallback:string)=><ChoiceField key={key} label={label} value={String(eff[key]??fallback)} disabled={disabled} options={options} onChange={v=>now(setParams({[key]:key==='fontWeight'?Number(v):v}),'Change '+label.toLowerCase())}/>;
  return <><Section title="Text"><TextField label="Text" bare multiline value={String(shownParams.text??'')} disabled={disabled} {...edit<string>('Edit text',v=>setParams({text:v}))}/>
   <ChoiceField label="Style" value={style?.id??''} disabled={disabled} options={[{id:'',name:'None'},...TEXT_STYLES.map(t=>({id:t.id,name:t.group==='Titles'?'Title · '+t.name:t.group==='Lower thirds'?'Lower third · '+t.name:t.name}))]} onChange={v=>{const keep=Object.fromEntries(Object.entries(params).filter(([key])=>['text','x','y','scale','rotation','opacity'].includes(key)));now([{type:'update_item',itemId:raw.id,changes:{component:'text',params:{...keep,...(v?{style:v}:{})}},reason}],'Change text style');}}/>
   {eff.subtext!==undefined&&<TextField label="Second line" value={String(eff.subtext??'')} disabled={disabled} {...edit<string>('Edit second line',v=>setParams({subtext:v}))}/>}
   <ChoiceField label="Kind" value={['title_card','lower_third'].includes(component)?component:'text'} disabled={disabled} options={[{id:'text',name:'Text'},{id:'lower_third',name:'Lower third'},{id:'title_card',name:'Title card'}]} onChange={v=>now([{type:'update_item',itemId:raw.id,changes:{component:v},reason}],'Change text kind')}/></Section>
   <Section title="Font">{choice('fontFamily','Font',FONTS.map(f=>({id:f,name:f})),'Arial')}{number('fontSize','Size',60,10,300,1,{unit:'px'})}
    {choice('fontWeight','Weight',[{id:'400',name:'Regular'},{id:'500',name:'Medium'},{id:'600',name:'Semibold'},{id:'700',name:'Bold'},{id:'900',name:'Black'}],'500')}
    <ToggleField label="Italic" value={!!eff.italic} disabled={disabled} onChange={v=>now(setParams({italic:v}),'Change italic')}/><ToggleField label="Capitals" value={!!eff.uppercase} disabled={disabled} onChange={v=>now(setParams({uppercase:v}),'Change capitals')}/>
    {number('letterSpacing','Letter spacing',0,-5,40,.5,{unit:'px'})}{colour('color','Colour','#ffffff')}</Section>
   <Section title="Look">{colour('stroke','Outline','',true)}{eff.stroke&&number('strokeWidth','Outline width',6,1,30,.5,{unit:'px'})}{colour('shadow','Shadow','',true)}{eff.shadow&&eff.shadow!=='transparent'&&<>{number('shadowBlur','Shadow blur',12,0,60,1,{unit:'px'})}{number('shadowY','Shadow drop',2,-40,40,1,{unit:'px'})}</>}
    {colour('glow','Glow','',true)}{eff.glow&&number('glowSize','Glow size',24,2,80,1,{unit:'px'})}{colour('background','Background','',true)}{eff.background&&<>{number('padding','Padding',18,0,80,1,{unit:'px'})}{number('radius','Corners',8,0,60,1,{unit:'px'})}</>}
    {colour('accent','Accent bar','',true)}<Segmented label="Align" value={eff.align==='left'?'left':'center'} disabled={disabled} options={[{id:'center',name:'Centre'},{id:'left',name:'Left'}]} onChange={v=>now(setParams({align:v==='left'?'left':'center'}),'Change text alignment')}/></Section>
   <Section title="Animation">{choice('animation','In',named(TEXT_ANIMATIONS,ANIMATION_NAMES),style?'fade':'none')}{choice('animationOut','Out',named(OUT_ANIMATIONS,ANIMATION_NAMES),'none')}{choice('loop','Loop',named(LOOP_ANIMATIONS,ANIMATION_NAMES),'none')}</Section>
   {transform}{timing}</>;}
 if(look==='sticker'){const sticker=stickerInfo(shownParams.sticker),choice=(key:string,label:string,options:readonly {id:string;name:string}[],fallback:string)=><ChoiceField key={key} label={label} value={String(shownParams[key]??fallback)} disabled={disabled} options={options} onChange={v=>now(setParams({[key]:v}),'Change '+label.toLowerCase())}/>;
  return <><Section title="Sticker"><ChoiceField label="Sticker" value={sticker?.id??''} disabled={disabled} options={STICKERS.map(s=>({id:s.id,name:s.name}))} onChange={v=>now(setParams({sticker:v,color:undefined,accent:undefined}),'Change sticker')}/>
   <ColorField label="Colour" value={String(shownParams.color??sticker?.color??'#ffffff')} disabled={disabled} {...edit<string|undefined>('Change sticker colour',v=>setParams({color:v}))}/>
   <ColorField label="Accent" value={String(shownParams.accent??sticker?.accent??'#ffffff')} disabled={disabled} {...edit<string|undefined>('Change sticker accent',v=>setParams({accent:v}))}/>
   {sticker?.id==='speech'&&<TextField label="Words" value={String(shownParams.text??'')} disabled={disabled} {...edit<string>('Edit sticker words',v=>setParams({text:v}))}/>}</Section>
   <Section title="Animation">{choice('animation','In',named(TEXT_ANIMATIONS.filter(a=>a!=='typewriter'&&a!=='words'),ANIMATION_NAMES),'pop')}{choice('animationOut','Out',named(OUT_ANIMATIONS,ANIMATION_NAMES),'none')}{choice('loop','Loop',named(LOOP_ANIMATIONS,ANIMATION_NAMES),sticker?.loop??'none')}</Section>{transform}{timing}</>;}
 if(look==='effect'){const info=effectInfo(raw.component);return <><Section title="Effect">{(info?.params??[{key:'amount',label:'Amount',min:0,max:1,step:.01,default:.5,unit:'%',scale:100}]).map(x=>param(x.key,x.label,x.default,x.min,x.max,x.step,{unit:x.unit,scale:x.scale}))}
  {info?.group==='look'&&<Segmented label="Changes" value={shownParams.apply==='all'?'all':'main'} disabled={disabled} options={[{id:'main',name:'Main track'},{id:'all',name:'Everything'}]} onChange={v=>now(setParams({apply:v==='all'?'all':undefined}),'Change what the effect changes')}/>}
  {info&&<p className="prop-hint">{info.about}</p>}</Section>{timing}</>;}
 if(look==='filter')return <><Section title="Filter"><ChoiceField label="Filter" value={String(shownParams.preset??'')} disabled={disabled} options={FILTER_OPTIONS} onChange={v=>now(setParams({preset:v||undefined}),'Change filter')}/>
  {typeof shownParams.preset==='string'&&param('intensity','Intensity',1,0,1,.01,{unit:'%',scale:100})}
  <Segmented label="Changes" value={shownParams.apply==='all'?'all':'main'} disabled={disabled} options={[{id:'main',name:'Main track'},{id:'all',name:'Everything'}]} onChange={v=>now(setParams({apply:v==='all'?'all':undefined}),'Change what the filter changes')}/></Section>
  <Section title="Adjust">{param('exposure','Exposure',0,-2,2,.05)}{param('contrast','Contrast',1,0,2,.01,{unit:'%',scale:100})}{param('saturation','Saturation',1,0,2,.01,{unit:'%',scale:100})}{param('temperature','Temperature',0,-1,1,.01,{scale:100})}{param('tint','Tint',0,-1,1,.01,{scale:100})}{param('fade','Fade',0,0,1,.01,{unit:'%',scale:100})}</Section>{timing}</>;
 if(look==='sfx')return <><Section title="Sound">{param('gainDb','Volume',-9,-40,12,.5,{unit:' dB'})}</Section>{timing}</>;
 const asset=f.assets.find(x=>x.id===raw.source?.assetId);
 return <>{transform}{raw.source&&<Section title="Fit"><Segmented label="Fit" value={shownParams.fit==='cover'?'cover':'contain'} disabled={disabled} options={[{id:'contain',name:'Whole picture'},{id:'cover',name:'Fill frame'}]} onChange={v=>now(setParams({fit:v}),'Change fit')}/></Section>}
  {look==='overlay'&&<>{filter}{adjust}</>}
  {asset?.hasAudio&&<Section title="Sound"><ToggleField label="Play its sound" value={shownParams.mute===false} disabled={disabled} onChange={v=>now(setParams({mute:!v}),v?'Play overlay sound':'Mute overlay')}/>{shownParams.mute===false&&param('gainDb','Volume',-9,-40,12,.5,{unit:' dB'})}</Section>}
  {timing}</>;
}

const FILTER_OPTIONS=[{id:'',name:'None'},...FILTERS.map(f=>({id:f.id,name:f.name}))];
const named=(list:readonly string[],names:Record<string,string>={})=>list.map(id=>({id,name:names[id]??id[0].toUpperCase()+id.slice(1).replaceAll('_',' ')}));
const ANIMATION_NAMES={none:'None',slide_up:'Slide up',slide_down:'Slide down',slide_left:'Slide left',slide_right:'Slide right',blur_in:'Blur in',blur_out:'Blur out',typewriter:'Typewriter',words:'Word by word'};
const CAPTION_OPTIONS=[{id:'off',name:'Off'},...CAPTION_STYLES.map(s=>({id:s.id,name:s.name}))];
/** Captions: the style, and its values (the style's own until changed here): size, colours, the highlight or word box, how
 * many words show at once and the height of the line. */
function CaptionSettings({p,base,edit,now,disabled}:Omit<Common,'time'|'fps'>){
 const c=base.captions,shown=p.timeline.captions,set=(params:Record<string,unknown>)=>c?[{type:'set_captions' as const,captions:{...c,params:{...c.params,...params}},reason}]:[];
 const q={...(captionStyle(shown?.style)?.params??{}),...shown?.params} as Record<string,any>,lit=q.highlight==='current'||q.highlight==='spoken';
 return <Section title="Captions">
  <ChoiceField label="Style" value={shown?.style??'off'} disabled={disabled} options={CAPTION_OPTIONS} onChange={v=>now([{type:'set_captions',captions:v==='off'?null:{style:v as NonNullable<typeof c>['style'],params:captionParamsFor(c?.params),overrides:c?.overrides??[]},reason}],v==='off'?'Turn captions off':'Change caption style')}/>
  {shown&&<><NumberField label="Size" value={Number(q.fontSize??42)} min={16} max={160} step={1} unit="px" disabled={disabled} {...edit<number>('Change caption size',v=>set({fontSize:v}))}/>
   <ColorField label="Colour" value={String(q.color??'#ffffff')} disabled={disabled} {...edit<string|undefined>('Change caption colour',v=>set({color:v??'#ffffff'}))}/>
   {lit&&!q.wordBox&&<ColorField label="Highlight" value={String(q.highlightColor??'#a5b8ff')} disabled={disabled} {...edit<string|undefined>('Change caption highlight',v=>set({highlightColor:v??'#a5b8ff'}))}/>}
   {q.wordBox&&<ColorField label="Word box" value={String(q.wordBox)} disabled={disabled} {...edit<string|undefined>('Change caption word box',v=>set({wordBox:v??q.wordBox}))}/>}
   <ColorField label="Box" allowNone value={String(q.background??'#00000088')} disabled={disabled} {...edit<string|undefined>('Change caption box',v=>set({background:v??'transparent'}))}/>
   {q.words!==undefined&&<NumberField label="Words at once" value={Number(q.words)} min={1} max={8} step={1} disabled={disabled} {...edit<number>('Change caption words at once',v=>set({words:Math.round(v)}))}/>}
   <NumberField label="Height" value={Math.round((1-Number(q.y??.9))*100)} min={5} max={90} step={1} unit="%" disabled={disabled} {...edit<number>('Change caption height',v=>set({y:1-v/100}))}/></>}
 </Section>;
}

function ProjectProperties({p,base,edit,now,disabled,duration}:Omit<Common,'time'|'fps'>&{duration:number}){
 const s=p.timeline.settings,ratio=canvasRatio(s.width,s.height);
 return <>
  <div className="prop-empty compact"><MousePointerClick size={16}/><small>Select something on the timeline to change it.</small></div>
  <Section title="Project">
   <ChoiceField label="Canvas" value={ratio} disabled={disabled} options={[...(canvasPresets.some(c=>c.ratio===ratio)?[]:[{id:ratio,name:ratio}]),...canvasPresets.map(c=>({id:c.ratio,name:`${c.ratio} ${c.name}`}))]} onChange={v=>{const preset=canvasPresets.find(c=>c.ratio===v);if(preset)now([{type:'set_project_settings',settings:{width:preset.width,height:preset.height},reason}],'Change canvas ratio');}}/>
   <ChoiceField label="Frame rate" value={String(s.fps)} disabled={disabled} options={['24','25','30','60'].map(id=>({id,name:id+' fps'}))} onChange={v=>now([{type:'set_project_settings',settings:{fps:Number(v) as 24|25|30|60},reason}],'Change frame rate')}/>
   <ToggleField label="Even out clip loudness" value={s.autoLevel!==false} disabled={disabled} onChange={v=>now([{type:'set_project_settings',settings:{autoLevel:v},reason}],'Change loudness levelling')}/>
   <p className="prop-hint">{Math.floor(duration/60)}:{String(Math.round(duration%60)).padStart(2,'0')} long · {s.width}×{s.height}</p>
  </Section>
  <CaptionSettings {...{p,base,edit,now,disabled}}/>
 </>;
}
