/** Frames must look the same in any order and on any run: randomness is seeded from the scene revision, and clocks
 * report the frame's time instead of wall time. */
let frameMs=0,ticks=0;
/** Wall time, captured before the clocks are replaced; only the engine uses it (timeouts). */
export const realNow=Date.now.bind(Date);
export function setFrameTime(seconds:number){frameMs=seconds*1000;ticks=0;}
function seed(text:string){let h=1779033703^text.length;for(let i=0;i<text.length;i++){h=Math.imul(h^text.charCodeAt(i),3432918353);h=h<<13|h>>>19;}return h>>>0;}
export function installDeterminism(revisionId:string){
 let state=seed(revisionId)||1;
 Math.random=()=>{state|=0;state=state+0x6D2B79F5|0;let t=Math.imul(state^state>>>15,1|state);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};
 // A tiny per-call step keeps the clock monotonic for code that waits for time to pass, without wall-clock drift.
 const now=()=>frameMs+(ticks++)*1e-6;
 try{Object.defineProperty(performance,'now',{value:now,configurable:true});}catch{}
 const epoch=Date.UTC(2026,0,1);Date.now=()=>epoch+Math.floor(now());
}
