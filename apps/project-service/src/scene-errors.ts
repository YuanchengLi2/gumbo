import {existsSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import type {ProjectDB} from '@dream/project-db';
import {mapStack} from './engine-compile';

/** Stores an error a scene reported while playing in the visible player or a chat preview. The stack is mapped back
 * to the authored file and line through the scene's source map, so the agent sees where to fix it. */
export async function recordSceneError(db:ProjectDB,report:{assetId?:string;revisionId?:string;draft?:string;message:string;stack?:string}){
 const asset=report.assetId?db.footage().assets.find(a=>a.id===report.assetId):undefined;
 const mapFile=report.draft&&/^[a-f0-9]{16,64}$/.test(report.draft)?join(db.folder,'Media/Drafts',report.draft,'scene.js.map'):asset?.scene?.format==='engine'?asset.originalPath+'.map':undefined;
 const location=report.stack&&mapFile&&existsSync(mapFile)?await mapStack(report.stack,readFileSync(mapFile,'utf8')).catch(()=>undefined):undefined;
 let turnId:string|undefined;try{turnId=JSON.parse(db.getMeta('pending_request')??'null')?.turnId;}catch{}
 return db.recordSceneError({assetId:report.assetId,revisionId:report.revisionId??asset?.scene?.revisionId,draft:report.draft,turnId,message:report.message,stack:report.stack,location});
}
