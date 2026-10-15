/** Whether the scene is being played live in the preview (the player says so with each frame it asks for), rather than
 * drawn frame by frame for a paused preview, the agent or Export. Live, videos play on their own and are only nudged back
 * when they drift; otherwise every frame shows exactly its moment. Components follow it with useLive, so pausing on the
 * frame already shown still stops their videos and puts them on that exact frame. */
const listeners=new Set<()=>void>();
export const live={playing:false};
export function setLive(playing:boolean){if(live.playing===playing)return;live.playing=playing;for(const listener of listeners)listener();}
export const subscribeLive=(listener:()=>void)=>{listeners.add(listener);return()=>{listeners.delete(listener);};};
