/** Gumbo's built-in libraries, part of the timeline document: the editor's panels list them, the agent writes their ids in
 * project.json, and the compositor draws them, so the preview and Export show the same thing. Everything here is original
 * (numbers and drawing code), not copied artwork or presets. */

/** Transitions into a clip (`transitionIn` on the incoming clip), centred on the cut and drawn over black. */
export const TRANSITION_TYPES=['cut','crossfade','dip_to_black','dip_to_white','flash','wipe','slide','whip','zoom_through','zoom_out','blur','spin','iris','glitch'] as const;
export type TransitionType=typeof TRANSITION_TYPES[number];
export const DIRECTIONS=['left','right','up','down'] as const;
export type Direction=typeof DIRECTIONS[number];
export const TRANSITIONS:{id:Exclude<TransitionType,'cut'>;name:string;durationSec:number;directional?:boolean;about:string}[]=[
 {id:'crossfade',name:'Cross dissolve',durationSec:.5,about:'The next shot fades in over this one.'},
 {id:'dip_to_black',name:'Dip to black',durationSec:.8,about:'Fades out to black, then in from black.'},
 {id:'dip_to_white',name:'Dip to white',durationSec:.8,about:'Fades out to white, then in from white.'},
 {id:'flash',name:'Flash',durationSec:.4,about:'A quick white flash on the cut.'},
 {id:'wipe',name:'Wipe',durationSec:.6,directional:true,about:'A hard edge sweeps the next shot in.'},
 {id:'slide',name:'Slide',durationSec:.5,directional:true,about:'The next shot pushes this one off the frame.'},
 {id:'whip',name:'Whip pan',durationSec:.35,directional:true,about:'A fast blurred pan into the next shot.'},
 {id:'zoom_through',name:'Zoom in',durationSec:.5,about:'Zooms into this shot and out of the next.'},
 {id:'zoom_out',name:'Zoom out',durationSec:.5,about:'This shot shrinks away as the next one settles in.'},
 {id:'blur',name:'Blur dissolve',durationSec:.6,about:'Both shots blur through the dissolve.'},
 {id:'spin',name:'Spin',durationSec:.6,about:'Turns and zooms into the next shot.'},
 {id:'iris',name:'Circle reveal',durationSec:.7,about:'The next shot opens from a circle in the middle.'},
 {id:'glitch',name:'Glitch',durationSec:.4,about:'A digital break-up on the cut.'}];
export const transitionInfo=(type:string)=>TRANSITIONS.find(t=>t.id===type);
