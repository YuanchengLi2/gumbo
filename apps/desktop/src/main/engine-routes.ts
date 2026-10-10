import {existsSync,readFileSync} from 'node:fs';
import {dirname,join,resolve,sep} from 'node:path';
import type {Asset} from '@dream/footage';
import {engineHostHtml,type HostConfig} from '../../../../packages/scene-engine/src/host-html';
import {mediaAssetPath} from './media-paths';

/** A compiled engine scene: its configuration, bundle and resources. Published scenes come from assets; drafts (code
 * the agent is still writing) come from the project service. */
export type SceneSource={config:HostConfig;bundlePath:string;files:Record<string,string>;storeDir:string};
/** Draft scenes by content hash, bounded so long sessions cannot grow memory without limit. */
export class DraftScenes {
 private drafts=new Map<string,SceneSource>();
 constructor(private limit=24){}
 set(hash:string,source:SceneSource){this.drafts.delete(hash);this.drafts.set(hash,source);while(this.drafts.size>this.limit)this.drafts.delete(this.drafts.keys().next().value!);}
 get(hash:string){const source=this.drafts.get(hash);if(source){this.drafts.delete(hash);this.drafts.set(hash,source);}return source;}
}

const resourcesOf=(bundlePath:string):Record<string,string>=>{const file=join(dirname(bundlePath),'resources.json');if(!existsSync(file))return{};try{return JSON.parse(readFileSync(file,'utf8')).files??{};}catch{return{};}};
/** Published engine scenes keep their compiled files in Media/Generated/<hash>/ and resources in Media/Engine/files/. */
export function sceneFromAsset(asset:Asset,beats:(musicId:string)=>number[]|undefined=()=>undefined):SceneSource|undefined{
 const scene=asset.scene;if(scene?.format!=='engine'||!scene.engine)return;
 // Scenes read beats by the music output's name; the asset behind each name supplies them.
 const music=Object.fromEntries(Object.entries(scene.engine.music).map(([name,assetId])=>[name,beats(assetId)??[]]));
 return{config:{assetId:asset.id,revisionId:scene.revisionId,width:asset.width,height:asset.height,fps:asset.fps,durationInFrames:scene.durationInFrames,chunks:scene.engine.chunks,props:scene.engine.props,transparent:scene.engine.transparent,beats:music},bundlePath:asset.originalPath,files:resourcesOf(asset.originalPath),storeDir:resolve(dirname(asset.originalPath),'..','..','Engine','files')};
}

export type EngineAnswer={kind:'file';path:string;immutable?:boolean}|{kind:'html';html:string;csp:string}|{kind:'missing'};
const inside=(root:string,path:string)=>{const full=resolve(root,path);return full===root||full.startsWith(root+sep)?full:undefined;};

/** Resolves an engine URL path (after the base: dream-engine://app or the export server's /<token>/engine). Paths
 * name registered assets, drafts and content hashes only, never arbitrary files. */
export function engineRoute(pathname:string,context:{runtimeDir:string;asset:(id:string)=>Asset|undefined;scene:(id:string)=>SceneSource|undefined;draft:(hash:string)=>SceneSource|undefined;cspSources:readonly string[]}):EngineAnswer{
 const parts=pathname.split('/').filter(Boolean).map(part=>decodeURIComponent(part));
 if(parts.some(part=>part==='..'||part.includes('\\')))return{kind:'missing'};
 if(parts[0]==='runtime'&&/^\d{1,4}$/.test(parts[1]??'')&&parts.length>2){const path=inside(resolve(context.runtimeDir,parts[1]),parts.slice(2).join('/'));return path&&existsSync(path)?{kind:'file',path,immutable:true}:{kind:'missing'};}
 const source=parts[0]==='scene'?context.scene(parts[1]??''):parts[0]==='draft'&&/^[a-f0-9]{16,64}$/.test(parts[1]??'')?context.draft(parts[1]):undefined;
 if(!source)return{kind:'missing'};
 const rest=parts.slice(2);
 if(rest.join('/')==='index.html'){const {html,csp}=engineHostHtml(source.config,{runtimeBase:'../../runtime/'+(parts[0]==='scene'?context.asset(parts[1])?.scene?.engine?.version??1:1),sceneBase:'.',cspSources:context.cspSources});return{kind:'html',html,csp};}
 if(rest.join('/')==='bundle.js')return existsSync(source.bundlePath)?{kind:'file',path:source.bundlePath}:{kind:'missing'};
 if(rest.join('/')==='bundle.js.map')return existsSync(source.bundlePath+'.map')?{kind:'file',path:source.bundlePath+'.map'}:{kind:'missing'};
 if(rest[0]==='files'&&rest.length>1){const hash=source.files[rest.slice(1).join('/')];const path=hash&&/^[a-f0-9]{64}$/.test(hash)?join(source.storeDir,hash):undefined;return path&&existsSync(path)?{kind:'file',path,immutable:true}:{kind:'missing'};}
 if(rest[0]==='media'&&rest.length===2){const media=context.asset(rest[1]);if(!media||media.scene)return{kind:'missing'};try{return{kind:'file',path:mediaAssetPath(media,'original')};}catch{return{kind:'missing'};}}
 return{kind:'missing'};
}
