/** Gumbo's built-in libraries, part of the timeline document: the editor's panels list them, the agent writes their ids in
 * project.json, and the compositor draws them, so the preview and Export show the same thing. Everything here is original
 * (numbers and drawing code), not copied artwork or presets. */

/** Transitions into a clip (`transitionIn` on the incoming clip), centred on the cut and drawn over black. */
export const TRANSITION_TYPES=['cut','crossfade','dip_to_black','dip_to_white','flash','wipe','slide','whip','zoom_through','zoom_out','blur','spin','iris','glitch',
 'cover','zoom_blur','film_burn','light_leak','shake_cut','clock_wipe','split','diagonal','smooth_wipe','blinds','flip','pixelate'] as const;
export type TransitionType=typeof TRANSITION_TYPES[number];
export const DIRECTIONS=['left','right','up','down'] as const;
export type Direction=typeof DIRECTIONS[number];
/** `strength` marks the ones whose look `intensity` (0-1, full by default) scales: how far they move, blur, burn or shake. */
export const TRANSITIONS:{id:Exclude<TransitionType,'cut'>;name:string;durationSec:number;directional?:boolean;strength?:boolean;about:string}[]=[
 {id:'crossfade',name:'Cross dissolve',durationSec:.5,about:'The next shot fades in over this one.'},
 {id:'dip_to_black',name:'Dip to black',durationSec:.8,about:'Fades out to black, then in from black.'},
 {id:'dip_to_white',name:'Dip to white',durationSec:.8,about:'Fades out to white, then in from white.'},
 {id:'flash',name:'Flash',durationSec:.4,strength:true,about:'A quick white flash on the cut.'},
 {id:'wipe',name:'Wipe',durationSec:.6,directional:true,about:'A hard edge sweeps the next shot in.'},
 {id:'slide',name:'Slide',durationSec:.5,directional:true,about:'The next shot pushes this one off the frame.'},
 {id:'whip',name:'Whip pan',durationSec:.35,directional:true,strength:true,about:'A fast pan into the next shot, streaked the way it moves.'},
 {id:'zoom_through',name:'Zoom in',durationSec:.5,strength:true,about:'Zooms into this shot and out of the next.'},
 {id:'zoom_out',name:'Zoom out',durationSec:.5,strength:true,about:'This shot shrinks away as the next one settles in.'},
 {id:'blur',name:'Blur dissolve',durationSec:.6,strength:true,about:'Both shots blur through the dissolve.'},
 {id:'spin',name:'Spin',durationSec:.6,strength:true,about:'Turns and zooms into the next shot.'},
 {id:'iris',name:'Circle reveal',durationSec:.7,about:'The next shot opens from a circle in the middle.'},
 {id:'glitch',name:'Glitch',durationSec:.4,strength:true,about:'A digital break-up on the cut.'},
 {id:'cover',name:'Slide over',durationSec:.5,directional:true,about:'The next shot slides in over this one.'},
 {id:'zoom_blur',name:'Zoom blur',durationSec:.45,strength:true,about:'Rushes into the middle with a radial blur and out of the next shot.'},
 {id:'film_burn',name:'Film burn',durationSec:.9,strength:true,about:'The film burns out to orange and white, then into the next shot.'},
 {id:'light_leak',name:'Light leak',durationSec:.9,strength:true,about:'Warm light washes across the cut.'},
 {id:'shake_cut',name:'Shake cut',durationSec:.4,strength:true,about:'A hard cut hit by a camera shake.'},
 {id:'clock_wipe',name:'Clock wipe',durationSec:.7,about:'The next shot sweeps round like a clock hand.'},
 {id:'split',name:'Split',durationSec:.6,directional:true,about:'The next shot opens from the middle like doors (left or right: sideways; up or down: from top and bottom).'},
 {id:'diagonal',name:'Diagonal wipe',durationSec:.6,directional:true,about:'A slanted edge sweeps the next shot in from a corner.'},
 {id:'smooth_wipe',name:'Soft wipe',durationSec:.7,directional:true,about:'A wipe with a soft feathered edge.'},
 {id:'blinds',name:'Blinds',durationSec:.7,directional:true,about:'The next shot opens in stripes.'},
 {id:'flip',name:'Flip',durationSec:.5,directional:true,about:'The picture flips over like a card to the next shot.'},
 {id:'pixelate',name:'Pixelate',durationSec:.6,strength:true,about:'Breaks into big pixels and resolves into the next shot.'}];
export const transitionInfo=(type:string)=>TRANSITIONS.find(t=>t.id===type);

/** A number an effect, filter or style can set, with its range for a slider. */
export type LibraryParam={key:string;label:string;min:number;max:number;step:number;default:number;unit?:string;scale?:number};
const amount=(value:number,max=1):LibraryParam=>({key:'amount',label:'Amount',min:0,max,step:.01,default:value,unit:'%',scale:100});
/** Effects: attached items of type `effect` that change the main-track clips under them while they last (`params.apply:
 * "all"` also changes overlay footage and photos). Motion effects move the picture; look effects are drawn by the
 * compositor's shader on the picture's own pixels. */
export const EFFECTS:{id:string;name:string;group:'motion'|'look';about:string;params:LibraryParam[]}[]=[
 {id:'slow_push',name:'Slow push',group:'motion',about:'A slow zoom in across each clip (Ken Burns).',params:[amount(.08,.3)]},
 {id:'pull_out',name:'Pull out',group:'motion',about:'A slow zoom out across each clip.',params:[amount(.08,.3)]},
 {id:'punch_zoom',name:'Zoom punch',group:'motion',about:'Holds the picture zoomed in, for a beat or a line.',params:[amount(.15,.4)]},
 {id:'zoom_pulse',name:'Pulse',group:'motion',about:'The picture pulses in and out on a beat.',params:[amount(.06,.3),{key:'rate',label:'Beats a second',min:.25,max:4,step:.05,default:2}]},
 {id:'shake',name:'Shake',group:'motion',about:'Camera shake for an impact.',params:[amount(.1,.5)]},
 {id:'blur',name:'Blur',group:'look',about:'Softens the picture.',params:[amount(.4)]},
 {id:'vignette',name:'Vignette',group:'look',about:'Darkens the corners.',params:[amount(.5)]},
 {id:'glow',name:'Glow',group:'look',about:'The bright parts bloom.',params:[amount(.5)]},
 {id:'grain',name:'Film grain',group:'look',about:'Moving film grain.',params:[amount(.4)]},
 {id:'vhs',name:'VHS',group:'look',about:'Tape look: colour bleed, scan lines, wobble and noise.',params:[amount(.6)]},
 {id:'glitch',name:'Glitch',group:'look',about:'Bursts of digital break-up.',params:[amount(.5)]},
 {id:'rgb_split',name:'RGB split',group:'look',about:'The colour channels pulled apart.',params:[amount(.4)]},
 {id:'pixelate',name:'Pixelate',group:'look',about:'Big square pixels.',params:[amount(.3)]},
 {id:'letterbox',name:'Cinema bars',group:'look',about:'Black bars top and bottom for a widescreen look.',params:[amount(.5)]}];
export const effectInfo=(id:string)=>EFFECTS.find(e=>e.id===id);

/** A grade: exposure in stops, contrast and saturation (1 leaves them), temperature and tint (-1 to 1), fade (0-1, lifted
 * blacks), hue (degrees) and a teal-and-orange split tone (0-1). */
export type GradeValues={exposure?:number;contrast?:number;saturation?:number;temperature?:number;tint?:number;fade?:number;hue?:number;splitTone?:number};
export const GRADE_KEYS=['exposure','contrast','saturation','temperature','tint','fade','hue','splitTone'] as const;
const NEUTRAL:Required<GradeValues>={exposure:0,contrast:1,saturation:1,temperature:0,tint:0,fade:0,hue:0,splitTone:0};
/** Filters: grade presets for a clip (`framing.filter`), an overlay (`params.filter`) or a stretch of the edit (an effect
 * item with component `grade` and `params.preset`), at an intensity from 0 to 1. */
export const FILTERS:{id:string;name:string;grade:GradeValues}[]=[
 {id:'warm',name:'Warm',grade:{exposure:.05,contrast:1.06,saturation:1.1,temperature:.45}},
 {id:'cool',name:'Cool',grade:{contrast:1.08,saturation:.92,temperature:-.45}},
 {id:'vivid',name:'Vivid',grade:{contrast:1.12,saturation:1.4}},
 {id:'cinematic',name:'Cinematic',grade:{exposure:-.08,contrast:1.15,saturation:.85,splitTone:.55}},
 {id:'teal_orange',name:'Teal & orange',grade:{contrast:1.1,saturation:1.1,splitTone:.95}},
 {id:'golden',name:'Golden hour',grade:{exposure:.08,saturation:1.15,temperature:.7,tint:.1}},
 {id:'vintage',name:'Vintage',grade:{contrast:.9,saturation:.75,temperature:.3,fade:.25,tint:.08}},
 {id:'faded',name:'Faded',grade:{contrast:.85,saturation:.8,fade:.3}},
 {id:'matte',name:'Matte',grade:{contrast:.92,saturation:.95,fade:.18}},
 {id:'moody',name:'Moody',grade:{exposure:-.25,contrast:1.15,saturation:.7,temperature:-.2}},
 {id:'pastel',name:'Pastel',grade:{exposure:.15,contrast:.8,saturation:.85,fade:.2,tint:.12}},
 {id:'neon',name:'Neon night',grade:{contrast:1.2,saturation:1.25,temperature:-.5,tint:.45}},
 {id:'retro',name:'Retro',grade:{contrast:1.05,saturation:.9,hue:-12,fade:.15,temperature:.25}},
 {id:'mono',name:'Black & white',grade:{contrast:1.15,saturation:0}},
 {id:'noir',name:'Noir',grade:{exposure:-.15,contrast:1.45,saturation:0}},
 {id:'sepia',name:'Sepia',grade:{contrast:1.05,saturation:.05,temperature:1,tint:.15,fade:.08}}];
export const filterInfo=(id:string)=>FILTERS.find(f=>f.id===id);
/** A filter's grade at an intensity: each value moved from neutral toward the preset's. */
export function filterGrade(id:string|undefined,intensity=1):GradeValues{
 const preset=id?filterInfo(id):undefined;if(!preset)return{};const k=Math.max(0,Math.min(1,intensity)),out:GradeValues={};
 for(const key of GRADE_KEYS){const v=preset.grade[key];if(v!==undefined)out[key]=NEUTRAL[key]+(v-NEUTRAL[key])*k;}return out;
}

/** Text animations: how text comes in (`animation`) and goes out (`animationOut`), and a movement while it shows (`loop`).
 * `words` brings the text in a word at a time, `stamp` slams it down from large, `bounce` drops it in with a bounce. */
export const TEXT_ANIMATIONS=['none','fade','pop','slide_up','slide_down','slide_left','slide_right','zoom','stamp','bounce','blur_in','typewriter','words'] as const;
export const OUT_ANIMATIONS=['none','fade','pop','slide_up','slide_down','zoom','blur_out'] as const;
export const LOOP_ANIMATIONS=['none','pulse','wiggle','float','bounce','spin','shake','flicker'] as const;
/** Fonts every Windows computer has, so the preview and Export (drawn on the same computer) set text alike. */
export const FONTS=['Arial','Arial Black','Segoe UI','Impact','Georgia','Times New Roman','Courier New','Trebuchet MS','Verdana','Segoe Script','Comic Sans MS'] as const;
/** Text styles: a text item (`component` `text`, `params.text`) with `params.style` takes the style's values under its own.
 * Lower thirds sit left-aligned (`align: "left"`, x is the box's left edge) with an `accent` bar and a smaller `subtext`
 * line under the name. */
export const TEXT_STYLE_GROUPS=['Text','Titles','Lower thirds'] as const;
export const TEXT_STYLES:{id:string;name:string;sample:string;group?:typeof TEXT_STYLE_GROUPS[number];params:Record<string,unknown>}[]=[
 {id:'basic',name:'Basic',sample:'Your text',params:{fontFamily:'Arial',fontWeight:600,fontSize:64,color:'#ffffff',shadow:'#00000088',shadowBlur:12,shadowY:2,animation:'fade'}},
 {id:'bold_title',name:'Bold title',sample:'BIG NEWS',params:{fontFamily:'Arial Black',fontWeight:900,fontSize:110,uppercase:true,color:'#ffffff',shadow:'#000000aa',shadowBlur:20,shadowY:4,animation:'pop'}},
 {id:'outline',name:'Outline',sample:'Outline',params:{fontFamily:'Arial Black',fontWeight:900,fontSize:96,color:'#ffffff',stroke:'#000000',strokeWidth:10,animation:'zoom'}},
 {id:'neon',name:'Neon',sample:'Neon',params:{fontFamily:'Segoe UI',fontWeight:700,fontSize:96,color:'#ffffff',glow:'#2fd6ff',glowSize:30,animation:'fade',loop:'pulse'}},
 {id:'label',name:'Label',sample:'Label',params:{fontFamily:'Segoe UI',fontWeight:700,fontSize:60,color:'#ffffff',background:'#111111',radius:14,padding:24,animation:'slide_up'}},
 {id:'highlight',name:'Highlight',sample:'Highlight',params:{fontFamily:'Arial Black',fontWeight:900,fontSize:68,color:'#111111',background:'#ffe14d',radius:6,padding:20,rotation:-2,animation:'pop'}},
 {id:'subtitle',name:'Subtitle',sample:'A line of dialogue',params:{fontFamily:'Segoe UI',fontWeight:600,fontSize:46,color:'#ffffff',background:'#000000a6',radius:8,padding:14,y:.86,animation:'fade'}},
 {id:'typewriter',name:'Typewriter',sample:'Typewriter',params:{fontFamily:'Courier New',fontWeight:700,fontSize:64,color:'#ffffff',shadow:'#000000aa',shadowBlur:8,animation:'typewriter'}},
 {id:'pop',name:'Pop',sample:'WOW!',params:{fontFamily:'Arial Black',fontWeight:900,fontSize:104,color:'#ffd93d',stroke:'#1a1a1a',strokeWidth:8,rotation:-4,animation:'pop',loop:'wiggle'}},
 {id:'retro',name:'Retro',sample:'RETRO',params:{fontFamily:'Impact',fontWeight:400,fontSize:120,uppercase:true,letterSpacing:6,color:'#ff5fa2',shadow:'#2b1b5a',shadowX:8,shadowY:8,shadowBlur:0,animation:'slide_up'}},
 {id:'elegant',name:'Elegant',sample:'Elegant',params:{fontFamily:'Georgia',italic:true,fontWeight:400,fontSize:84,letterSpacing:2,color:'#ffffff',shadow:'#00000066',shadowBlur:10,animation:'fade'}},
 {id:'handwritten',name:'Handwritten',sample:'Hello there',params:{fontFamily:'Segoe Script',fontWeight:700,fontSize:76,color:'#ffffff',shadow:'#00000077',shadowBlur:8,animation:'typewriter'}},
 {id:'comic',name:'Comic',sample:'Kaboom!',params:{fontFamily:'Comic Sans MS',fontWeight:700,fontSize:84,color:'#ffffff',stroke:'#e63946',strokeWidth:8,animation:'pop',loop:'bounce'}},
 {id:'cinematic_title',name:'Cinematic',group:'Titles',sample:'THE JOURNEY',params:{fontFamily:'Times New Roman',fontWeight:400,fontSize:88,uppercase:true,letterSpacing:24,color:'#f5f1e8',shadow:'#00000099',shadowBlur:18,y:.5,animation:'blur_in',animationSec:1.2,animationOut:'fade',animationOutSec:.8}},
 {id:'impact',name:'Impact',group:'Titles',sample:'NO WAY',params:{fontFamily:'Impact',fontWeight:400,fontSize:150,uppercase:true,color:'#ffe14d',stroke:'#000000',strokeWidth:12,y:.5,animation:'stamp',animationOut:'pop'}},
 {id:'shadow_3d',name:'3D shadow',group:'Titles',sample:'LEVEL UP',params:{fontFamily:'Arial Black',fontWeight:900,fontSize:116,uppercase:true,color:'#ffffff',shadow:'#ff3b5c',shadowX:9,shadowY:9,shadowBlur:0,y:.5,animation:'bounce'}},
 {id:'word_by_word',name:'Word by word',group:'Titles',sample:'One word at a time',params:{fontFamily:'Arial Black',fontWeight:900,fontSize:92,uppercase:true,color:'#ffffff',shadow:'#000000aa',shadowBlur:16,shadowY:4,y:.5,animation:'words'}},
 {id:'headline',name:'Headline',group:'Titles',sample:'BREAKING',params:{fontFamily:'Arial Black',fontWeight:900,fontSize:84,uppercase:true,color:'#ffffff',background:'#e63946',padding:24,radius:4,rotation:-2,y:.5,animation:'stamp',loop:'pulse'}},
 {id:'sticker_text',name:'Sticker',group:'Titles',sample:'so good',params:{fontFamily:'Arial Black',fontWeight:900,fontSize:76,color:'#111111',background:'#ffffff',padding:24,radius:22,rotation:3,shadow:'#00000066',shadowBlur:18,shadowY:6,y:.5,animation:'bounce',loop:'float'}},
 {id:'gold',name:'Gold',group:'Titles',sample:'Golden',params:{fontFamily:'Georgia',fontWeight:700,fontSize:104,color:'#ffd27a',stroke:'#7a4b00',strokeWidth:3,glow:'#ffb703',glowSize:22,y:.5,animation:'zoom'}},
 {id:'minimal_title',name:'Minimal',group:'Titles',sample:'minimal',params:{fontFamily:'Segoe UI',fontWeight:300,fontSize:84,letterSpacing:14,color:'#ffffff',y:.5,animation:'blur_in',animationSec:.8,animationOut:'blur_out'}},
 {id:'glitch_title',name:'Glitch',group:'Titles',sample:'GLITCH',params:{fontFamily:'Arial Black',fontWeight:900,fontSize:112,uppercase:true,color:'#ffffff',shadow:'#00e5ff',shadowX:-6,shadowY:0,shadowBlur:0,glow:'#ff2d55',glowSize:6,y:.5,animation:'stamp',loop:'shake'}},
 {id:'lt_bar',name:'Bar',group:'Lower thirds',sample:'Alex Rivera',params:{fontFamily:'Segoe UI',fontWeight:700,fontSize:46,color:'#ffffff',background:'#111111e6',padding:22,radius:2,accent:'#ff3b5c',align:'left',x:.06,y:.82,subtext:'Founder, Studio North',animation:'slide_right',animationOut:'fade'}},
 {id:'lt_clean',name:'Clean',group:'Lower thirds',sample:'Alex Rivera',params:{fontFamily:'Segoe UI',fontWeight:600,fontSize:52,color:'#ffffff',shadow:'#00000099',shadowBlur:10,shadowY:2,accent:'#ffffff',align:'left',x:.06,y:.84,subtext:'Director of photography',animation:'slide_right',animationOut:'fade'}},
 {id:'lt_bold',name:'Bold',group:'Lower thirds',sample:'ALEX RIVERA',params:{fontFamily:'Arial Black',fontWeight:900,fontSize:50,uppercase:true,color:'#111111',background:'#ffe14d',padding:20,radius:0,align:'left',x:.06,y:.84,subtext:'Host',subColor:'#111111',animation:'slide_right',animationOut:'slide_down'}},
 {id:'lt_news',name:'News',group:'Lower thirds',sample:'Live from the city',params:{fontFamily:'Arial',fontWeight:700,fontSize:48,color:'#ffffff',background:'#c1121f',padding:20,radius:0,accent:'#ffffff',align:'left',x:.06,y:.84,subtext:'Reporting: Alex Rivera',animation:'slide_up',animationOut:'slide_down'}},
 {id:'lt_elegant',name:'Elegant',group:'Lower thirds',sample:'Alex Rivera',params:{fontFamily:'Georgia',italic:true,fontWeight:400,fontSize:54,color:'#ffffff',shadow:'#00000088',shadowBlur:12,accent:'#d4af37',align:'left',x:.06,y:.84,subtext:'Wedding planner',subColor:'#d4af37',animation:'fade',animationSec:.7,animationOut:'fade'}}];
export const textStyle=(id:unknown)=>TEXT_STYLES.find(s=>s.id===id);

/** Caption styles (`captions.style`), under the values `captions.params` sets: how many words show at once (`words`; the
 * first styles keep their sliding line of up to seven, word pop one word), which words take `highlightColor` (the
 * `current` one, the words already `spoken`, or `none`; words marked emphasis always do, except one word at a time), a
 * coloured box behind the current word (`wordBox`), the current word grown by `pop`, `reveal` showing words only once
 * they are said, the font and look of the text styles, `background` (the box behind the line) and `y` (0-1, the line's
 * centre; at the bottom when unset). Grouped styles hold the line through short pauses between words. */
export const CAPTION_STYLES:{id:string;name:string;about:string;params:Record<string,unknown>}[]=[
 {id:'clean',name:'Clean',about:'A line of the words in a box.',params:{}},
 {id:'karaoke',name:'Karaoke',about:'The word being said lights up.',params:{highlight:'current'}},
 {id:'word_pop',name:'Word pop',about:'One word at a time.',params:{words:1}},
 {id:'emphasis',name:'Emphasis',about:'Words you mark stand out.',params:{}},
 {id:'bounce',name:'Bounce',about:'Three words at a time; the one being said pops up in yellow.',params:{words:3,highlight:'current',pop:1.22,uppercase:true,fontFamily:'Arial Black',fontWeight:900,fontSize:66,color:'#ffffff',highlightColor:'#ffe14d',stroke:'#000000',strokeWidth:9,background:'transparent',y:.72}},
 {id:'highlight',name:'Highlight',about:'The word being said sits on a coloured box.',params:{words:4,highlight:'current',wordBox:'#7c3aed',fontFamily:'Arial Black',fontWeight:900,fontSize:58,color:'#ffffff',stroke:'#000000',strokeWidth:4,background:'transparent',y:.76}},
 {id:'typewriter',name:'Typewriter',about:'Words appear as they are said.',params:{words:6,reveal:true,fontFamily:'Courier New',fontWeight:700,fontSize:48,color:'#ffffff',background:'#000000b3'}},
 {id:'fill',name:'Fill',about:'Words fill with colour as they are said.',params:{words:5,highlight:'spoken',fontFamily:'Arial Black',fontWeight:900,fontSize:56,color:'#ffffff',highlightColor:'#3ee8ff',stroke:'#000000',strokeWidth:6,background:'transparent',y:.76}},
 {id:'bold',name:'Bold',about:'Two big words at a time, the current one in yellow.',params:{words:2,highlight:'current',pop:1.1,uppercase:true,fontFamily:'Impact',fontWeight:400,fontSize:104,color:'#ffffff',highlightColor:'#ffe14d',stroke:'#000000',strokeWidth:11,background:'transparent',y:.66}},
 {id:'neon',name:'Neon',about:'Glowing words, the current one in cyan.',params:{words:3,highlight:'current',fontFamily:'Segoe UI',fontWeight:700,fontSize:62,color:'#ffffff',highlightColor:'#2fd6ff',glow:'#2fd6ff',glowSize:22,background:'transparent',y:.74}},
 {id:'outline',name:'Outline',about:'White words outlined in black, no box.',params:{words:5,highlight:'current',fontFamily:'Arial Black',fontWeight:900,fontSize:54,color:'#ffffff',highlightColor:'#ffe14d',stroke:'#000000',strokeWidth:7,background:'transparent'}},
 {id:'minimal',name:'Minimal',about:'Small, quiet subtitles with a soft shadow.',params:{words:7,fontFamily:'Segoe UI',fontWeight:600,fontSize:40,color:'#ffffff',shadow:'#000000aa',shadowBlur:10,background:'transparent'}}];
export const CAPTION_STYLE_IDS=['clean','karaoke','word_pop','emphasis','bounce','highlight','typewriter','fill','bold','neon','outline','minimal'] as const;
export const captionStyle=(id:unknown)=>CAPTION_STYLES.find(s=>s.id===id);
/** The params kept when captions change style: which sources they follow, not the old style's look, so the new style
 * shows as it is (as a CapCut caption template replaces the last one). */
export const captionParamsFor=(params:Record<string,unknown>|undefined)=>params?.sources===undefined?{}:{sources:params.sources};

/** Stickers: an overlay item with component `sticker` and `params.sticker`, drawn by the compositor from Gumbo's own vector
 * drawings (no image files, no third-party artwork), with an entrance (`animation`) and a movement (`loop`). */
export const STICKER_GROUPS=['Shapes','Faces','Signs'] as const;
export const STICKERS:{id:string;name:string;group:typeof STICKER_GROUPS[number];color:string;accent:string;loop:typeof LOOP_ANIMATIONS[number]}[]=[
 {id:'star',name:'Star',group:'Shapes',color:'#ffd23f',accent:'#ffffff',loop:'spin'},
 {id:'heart',name:'Heart',group:'Shapes',color:'#ff4d6d',accent:'#ffffff',loop:'pulse'},
 {id:'sparkle',name:'Sparkle',group:'Shapes',color:'#fff4b8',accent:'#ffd23f',loop:'none'},
 {id:'burst',name:'Burst',group:'Shapes',color:'#ff7a1a',accent:'#ffe14d',loop:'pulse'},
 {id:'ring',name:'Ring',group:'Shapes',color:'#ffffff',accent:'#ff4d6d',loop:'pulse'},
 {id:'lightning',name:'Lightning',group:'Shapes',color:'#ffd23f',accent:'#ff7a1a',loop:'wiggle'},
 {id:'fire',name:'Fire',group:'Shapes',color:'#ff5a1f',accent:'#ffd23f',loop:'none'},
 {id:'sun',name:'Sun',group:'Shapes',color:'#ffc94d',accent:'#ff9f1c',loop:'none'},
 {id:'cloud',name:'Cloud',group:'Shapes',color:'#ffffff',accent:'#cfe3ff',loop:'float'},
 {id:'music',name:'Music',group:'Shapes',color:'#ffffff',accent:'#9b8cff',loop:'bounce'},
 {id:'confetti',name:'Confetti',group:'Shapes',color:'#ff4d6d',accent:'#3ec1ff',loop:'none'},
 {id:'crown',name:'Crown',group:'Shapes',color:'#ffc93c',accent:'#ff4d6d',loop:'wiggle'},
 {id:'smile',name:'Smile',group:'Faces',color:'#ffcc33',accent:'#3b2a14',loop:'bounce'},
 {id:'laugh',name:'Laughing',group:'Faces',color:'#ffcc33',accent:'#3b2a14',loop:'wiggle'},
 {id:'love',name:'Love',group:'Faces',color:'#ffcc33',accent:'#ff3b5c',loop:'pulse'},
 {id:'wow',name:'Wow',group:'Faces',color:'#ffcc33',accent:'#3b2a14',loop:'pulse'},
 {id:'cool',name:'Cool',group:'Faces',color:'#ffcc33',accent:'#1a1a1a',loop:'float'},
 {id:'wink',name:'Wink',group:'Faces',color:'#ffcc33',accent:'#3b2a14',loop:'wiggle'},
 {id:'sad',name:'Sad',group:'Faces',color:'#ffcc33',accent:'#3b2a14',loop:'float'},
 {id:'angry',name:'Angry',group:'Faces',color:'#ff7043',accent:'#3b1a0e',loop:'wiggle'},
 {id:'arrow',name:'Arrow',group:'Signs',color:'#ffffff',accent:'#111111',loop:'float'},
 {id:'check',name:'Check',group:'Signs',color:'#22c55e',accent:'#ffffff',loop:'pulse'},
 {id:'cross',name:'Cross',group:'Signs',color:'#ef4444',accent:'#ffffff',loop:'pulse'},
 {id:'pin',name:'Location',group:'Signs',color:'#ef4444',accent:'#ffffff',loop:'bounce'},
 {id:'play',name:'Play button',group:'Signs',color:'#ff2d2d',accent:'#ffffff',loop:'pulse'},
 {id:'speech',name:'Speech bubble',group:'Signs',color:'#ffffff',accent:'#111111',loop:'none'},
 {id:'new',name:'New badge',group:'Signs',color:'#ff2d55',accent:'#ffffff',loop:'spin'}];
export const stickerInfo=(id:unknown)=>STICKERS.find(s=>s.id===id);

/** What an attached item is, which decides its timeline row: effects, filters, text, stickers, overlays or sound. */
export type ItemKind='sfx'|'effect'|'filter'|'text'|'sticker'|'visual';
export function itemKind(i:{type:string;component:string;params:Record<string,unknown>;source?:unknown}):ItemKind{
 if(i.type==='sfx')return'sfx';if(i.type==='effect')return i.component==='grade'?'filter':'effect';
 if(!i.source&&i.component==='sticker')return'sticker';if(!i.source&&typeof i.params.text==='string')return'text';return'visual';
}
/** The track id an attached item is on (what trackSettings names to hide, mute or lock it). */
export const itemTrackId=(i:Parameters<typeof itemKind>[0]&{layer:number})=>{const k=itemKind(i);return(k==='sfx'?'audio':k==='effect'?'effects':k==='filter'?'filters':k==='text'?'text':k==='sticker'?'stickers':'visual')+':'+i.layer;};
