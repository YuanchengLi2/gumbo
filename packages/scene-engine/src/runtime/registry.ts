import {ENGINE_VERSION} from '../protocol';
import {MODULES,moduleName} from '../modules';

export type Registry={version:number;define(name:string,factory:()=>unknown):void;require(name:string):any;has(name:string):boolean;frameHooks:((seconds:number)=>void)[]};

/** One registry per scene document. Chunks define modules lazily; scenes and other chunks require them, so every
 * consumer shares one React, one Remotion and one three.js. */
export function installRegistry():Registry{
 const existing=(globalThis as any).DreamEngine as Registry|undefined;if(existing)return existing;
 const factories=new Map<string,()=>unknown>(),modules=new Map<string,unknown>();
 const registry:Registry={
  version:ENGINE_VERSION,frameHooks:[],
  define(name,factory){factories.set(name,factory);modules.delete(name);},
  has:name=>factories.has(moduleName(name)),
  require(specifier){
   const name=moduleName(specifier);if(modules.has(name))return modules.get(name);
   const factory=factories.get(name);
   if(!factory){const chunk=MODULES[name];throw new Error(chunk?`The ${chunk} runtime chunk was not loaded for "${name}". Publish the scene again so its imports are recompiled.`:`"${specifier}" is not available in this scene.`);}
   const value=factory();modules.set(name,value);return value;
  },
 };
 (globalThis as any).DreamEngine=registry;return registry;
}
