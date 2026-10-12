import {readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {WorkspaceDocumentSchema,type WorkspaceDraft} from '@dream/contracts';
import type {Asset} from '@dream/footage';
import {resolve as resolveTimeline} from '@dream/timeline';
import type {ProjectDB} from '@dream/project-db';
import {digest} from '../../../packages/project-db/src/workspace-store';
import {documentErrors} from './document-errors';

/** The agent's edit as it stands in project.json, before it is published: the same parse and timing as publishing, with
 * a placeholder for each declared output that is not built yet (scenes compile, sound renders and media is copied only
 * on publish). null when project.json is the published edit. A document that is half-written or does not resolve comes
 * back with its error and no timeline, so the last good draft stays on screen. Nothing is built, stored or run here. */
export function workspaceDraft(db:ProjectDB):WorkspaceDraft|null{
 const file=join(db.folder,'Workspace','project.json');if(!existsSync(file))return null;
 const text=readFileSync(file,'utf8'),hash=digest(text);
 let raw:unknown;try{raw=JSON.parse(text);}catch{return{hash,error:'project.json is being written.'};}
 const parsed=WorkspaceDocumentSchema.safeParse(raw);if(!parsed.success)return{hash,error:documentErrors(parsed.error,3)};
 const document=parsed.data,published=db.timeline(),timeline=structuredClone(document.timeline);timeline.id=published.id;
 if(!document.outputs.length&&JSON.stringify(timeline)===JSON.stringify(published))return null;
 const footage=db.footage(),known=new Set(footage.assets.map(a=>a.id)),settings=timeline.settings;
 // How long the timeline uses each output: a placeholder must be at least that long, since its media does not exist yet.
 const used=new Map<string,number>();for(const clip of [...timeline.spine,...timeline.music,...timeline.attached.flatMap(i=>i.source?[i.source]:[])])used.set(clip.assetId,Math.max(used.get(clip.assetId)??0,clip.srcOut));
 const pending:WorkspaceDraft['pending']=[],placeholders:Asset[]=document.outputs.map(output=>{
  const id='output:'+output.id,fps=output.fps??settings.fps,scene=output.kind==='scene',kind=scene?'video':output.kind==='music'||output.kind==='sfx'?'audio':output.kind;
  pending.push({assetId:id,outputId:output.id,kind:output.kind,path:output.path});
  return{id,filename:output.id,kind,durationSec:Math.max(scene&&output.durationInFrames?output.durationInFrames/fps:0,used.get(id)??0,1/fps),fps,width:output.width??settings.width,height:output.height??settings.height,contentType:'mixed',hasAudio:kind==='audio'||kind==='video'&&!scene,rotation:0,originalPath:'',fingerprint:id,missing:false,waveform:[],status:'ready'} as Asset;
 });
 const all=[...footage.assets,...placeholders],ids=new Set(all.map(a=>a.id));
 const unknown=[...used.keys()].filter(id=>!ids.has(id));if(unknown.length)return{hash,error:`Unknown asset ${unknown[0]}.`};
 try{const resolved=resolveTimeline(timeline,{...footage,assets:all});if(!Number.isFinite(resolved.durationSec))return{hash,error:'The timeline has invalid timing.'};}
 catch(error){return{hash,error:(error as Error).message};}
 return{hash,basedOn:document.baseVersionId,timeline,assets:placeholders.filter(a=>!known.has(a.id)),pending};
}
