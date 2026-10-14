import type {ProjectDB} from '@dream/project-db';

/** The media an edit uses, by asset id: main-track clips, attached items, music, and the media its scenes draw on. */
function usedAssets(db:ProjectDB,versionId?:string){
 try{
  const t=db.timeline(versionId),assets=new Map(db.footage().assets.map(a=>[a.id,a]));
  const used=new Set<string>([...t.spine.map(c=>c.assetId),...t.attached.flatMap(i=>i.source?[i.source.assetId]:[]),...t.music.map(m=>m.assetId)]);
  for(const id of [...used])for(const ref of assets.get(id)?.scene?.engine?.assets??[])used.add(ref);
  return used;
 }catch{return new Set<string>();}
}
/** Credits owed for downloaded media a request put into the edit (CC BY and CC BY-SA ask for one), for the reply, so the user
 * can add them where the video is published. Media already in the edit when the request started was credited then. */
export function newCredits(db:ProjectDB,startVersion?:string){
 const before=startVersion?usedAssets(db,startVersion):new Set<string>(),now=usedAssets(db);
 const lines=db.footage().assets.filter(a=>now.has(a.id)&&!before.has(a.id)&&a.license?.attribution).map(a=>'- '+a.license!.attribution);
 return lines.length?`Credits to include where you publish the video (their licenses ask for it):\n${lines.join('\n')}`:undefined;
}
