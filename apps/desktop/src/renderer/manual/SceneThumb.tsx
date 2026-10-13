import React,{useEffect,useState} from 'react';
import type {Asset} from '@dream/footage';
import {sceneUrl,legacyDocument} from '../engine/scenes';

/** A motion-graphics scene's picture on its timeline block: one still from about 40% into the scene, drawn once per scene
 * revision in a hidden window and tiled along the block like video frames. Stills are made one at a time and reused. */
const stills=new Map<string,Promise<string|undefined>>();
let queue:Promise<unknown>=Promise.resolve();
function still(asset:Asset){
 const key=asset.id+':'+asset.scene!.revisionId;let found=stills.get(key);
 if(!found){
  found=new Promise<string|undefined>(resolve=>{queue=queue.then(async()=>{
   try{const total=Math.max(1,asset.scene!.durationInFrames),source=asset.scene!.format==='engine'?{url:sceneUrl(asset)}:{html:await legacyDocument(asset)};
    resolve(await window.dream.sceneStill({source,width:asset.width,height:asset.height,frame:Math.min(total-1,Math.round(total*.4)),fps:asset.fps||30}));}
   catch{resolve(undefined);}
  });});
  stills.set(key,found);
 }
 return found;
}

export function SceneThumb({asset}:{asset:Asset}){
 const [url,setUrl]=useState<string>();
 useEffect(()=>{let current=true;setUrl(undefined);void still(asset).then(value=>{if(current)setUrl(value);});return()=>{current=false;};},[asset.id,asset.scene?.revisionId]);
 return url?<div className="manual-clip-thumbnails scene-thumb" style={{backgroundImage:`url("${url}")`}} aria-hidden="true"/>:null;
}
