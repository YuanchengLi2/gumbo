import {useCallback,useRef} from 'react';
import type {ProjectState} from '@dream/project-db';

/** A function that keeps one identity for the component's life and always runs the newest one given, so a panel kept
 * from re-rendering (sameProps) still calls today's handler, not the one from when it last drew. */
export function useStable<T extends (...args:any[])=>any>(fn:T):T{const latest=useRef(fn);latest.current=fn;return useCallback(((...args:any[])=>latest.current(...args)) as T,[]);}

/** Props equal for drawing, with `project` compared only on the fields the component reads. While Gumbo works the project
 * object changes with every streamed word (its activity is inside it), and re-drawing the whole window for each one left a
 * long run at 4 frames a second with keystrokes waiting a quarter of a second. */
export const sameProps=(fields:readonly (keyof ProjectState)[])=>(a:Record<string,any>,b:Record<string,any>)=>{
 for(const key in {...a,...b}){if(key==='project'){if(a.project!==b.project&&!fields.every(field=>a.project?.[field]===b.project?.[field]))return false;}else if(!Object.is(a[key],b[key]))return false;}
 return true;
};

/** Two lists holding the same items in the same order. */
export const sameItems=(a:readonly unknown[]=[],b:readonly unknown[]=[])=>a===b||a.length===b.length&&a.every((item,n)=>item===b[n]);
