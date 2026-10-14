import React from 'react';
import {SourceVideo} from './api/media';
import {resource} from './api/files';
export * from 'remotion';

const warned=new Set<string>();
const warnOnce=(key:string,message:string)=>{if(warned.has(key))return;warned.add(key);console.warn(message);};

/** Scenes are pictures; sound belongs on the timeline (music and sound-effect outputs), so audio here is ignored. */
export function Audio(_props:Record<string,unknown>){warnOnce('audio','<Audio> is ignored inside scenes: put music and sound effects on the timeline instead.');return null;}
export const Html5Audio=Audio;
/** Video elements inside scenes seek to the exact frame. */
export function Video(props:any){return <SourceVideo {...props}/>;}
export const OffthreadVideo=Video,Html5Video=Video;
const notInScenes=(name:string)=>()=>{throw new Error(`${name} is not used in Dream scenes: the scene file exports a default component, and its size, frame rate and length come from project.json.`);};
export const registerRoot=notInScenes('registerRoot'),Composition=notInScenes('<Composition>'),Still=notInScenes('<Still>');
/** staticFile('name.png') reads a file from the workspace resources/ folder. */
export const staticFile=resource;
