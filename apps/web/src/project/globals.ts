import {Buffer} from 'buffer';
/** What the project service expects of Node's globals, in the project worker: Buffer, process (its environment, the
 * parent port the desktop's utility process talks over, its pid for the project lock), __dirname and setImmediate.
 * Imported first, before any of the service's modules. */
type Listener=(message:{data:unknown})=>void;
const portListeners:Listener[]=[];
const g=globalThis as any;
g.Buffer=Buffer;g.global=g;g.__dirname='/app';g.__filename='/app/main.js';
g.setImmediate??=(fn:(...a:unknown[])=>void,...args:unknown[])=>setTimeout(fn,0,...args);g.clearImmediate??=clearTimeout;
const pid=Math.floor(Math.random()*1e9)+1000;
g.process={
 env:{} as Record<string,string|undefined>,platform:'linux',arch:'wasm',pid,ppid:1,versions:{node:'22.0.0'},version:'v22.0.0',argv:['gumbo'],execArgv:[],
 cwd:()=>'/',on(){return g.process;},once(){return g.process;},off(){return g.process;},removeListener(){return g.process;},emit(){return false;},
 exit(code=0){(self as unknown as Worker).postMessage({exited:code});},
 // Only this worker's own pid is alive: a project lock left by a closed tab is stale.
 kill(target:number){if(target===pid)return true;throw Object.assign(new Error('kill ESRCH'),{code:'ESRCH'});},
 nextTick:(fn:(...a:unknown[])=>void,...args:unknown[])=>queueMicrotask(()=>fn(...args)),
 hrtime:Object.assign((prev?:[number,number])=>{const now=performance.now()*1e6,s=Math.floor(now/1e9),n=Math.floor(now%1e9);return prev?[s-prev[0],n-prev[1]]:[s,n];},{bigint:()=>BigInt(Math.round(performance.now()*1e6))}),
 memoryUsage:()=>({rss:0,heapUsed:0,heapTotal:0,external:0}),uptime:()=>performance.now()/1000,
 // The desktop's utility-process port: the service's messages go to the page, and the page's reach its listener.
 parentPort:{on(type:string,fn:Listener){if(type==='message')portListeners.push(fn);},postMessage(message:unknown){(self as unknown as Worker).postMessage(message);}},
};
/** A message from the page for the project service (main.ts listens on process.parentPort). */
export const deliver=(data:unknown)=>{for(const fn of portListeners)fn({data});};
