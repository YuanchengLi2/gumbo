import {pathToFileURL} from 'node:url';
export type ExchangeClip={id:string;name:string;path:string;kind:'video'|'audio';track:string;trackId?:string;trackOrder?:number;linkGroup?:string;start:number;end:number;sourceIn:number;sourceOut:number;sourceDuration:number;sourceFps:number;width:number;height:number;enabled:boolean;gainDb?:number;fadeInSec?:number;fadeOutSec?:number;automation?:{timeSec:number;value:number}[]};
const xml=(value:unknown)=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
function rate(fps:number){const timebase=Math.round(fps),ntsc=Math.abs(fps-timebase*1000/1001)<.01;return '<rate><timebase>'+timebase+'</timebase><ntsc>'+(ntsc?'TRUE':'FALSE')+'</ntsc></rate>';}
type Lane={kind:'video'|'audio';name:string;key:string;order:number;lane:number;channel:number;clips:ExchangeClip[]};
export function exchangeTracks(clips:ExchangeClip[]):Lane[]{
 const groups=new Map<string,Lane[]>();
 for(const clip of [...clips].sort((a,b)=>a.start-b.start||a.id.localeCompare(b.id))){
  if(clip.end<=clip.start)continue;const key=clip.kind+':'+(clip.trackId??clip.track);const lanes=groups.get(key)??[];
  let lane=lanes.find(l=>l.clips.at(-1)!.end<=clip.start+1e-7);if(!lane){lane={kind:clip.kind,name:clip.track,key,order:clip.trackOrder??0,lane:lanes.length,channel:0,clips:[]};lanes.push(lane);groups.set(key,lanes);}lane.clips.push(clip);
 }
 return [...groups.values()].flat().sort((a,b)=>a.order-b.order||a.key.localeCompare(b.key)||a.lane-b.lane).flatMap(lane=>lane.kind==='audio'?[{...lane,channel:1},{...lane,channel:2}]:[lane]);
}
/** FCP 7 XML: sequence positions use sequence frames; source in/out use source frames. */
export function timelineXML(name:string,settings:{fps:number;width:number;height:number},duration:number,clips:ExchangeClip[]){
 const {fps,width,height}=settings,lanes=exchangeTracks(clips),entries=lanes.flatMap(lane=>lane.clips.map((clip,index)=>({clip,lane,index:index+1,track:lanes.filter(l=>l.kind===lane.kind).indexOf(lane)+1,id:clip.id+(lane.channel?'-ch'+lane.channel:'')})));
 const track=(kind:'video'|'audio')=>lanes.filter(l=>l.kind===kind).map(lane=>'<track><name>'+xml(lane.name+(lane.lane?' '+(lane.lane+1):'')+(lane.channel===1?' L':lane.channel===2?' R':''))+'</name>'+entries.filter(e=>e.lane===lane).map(entry=>{
  const c=entry.clip,sourceRate=c.kind==='audio'?fps:c.sourceFps||fps,durationFrames=Math.max(1,Math.round(c.sourceDuration*sourceRate));
  const links=entries.filter(e=>(e.clip.linkGroup??e.clip.id)===(c.linkGroup??c.id)).map(e=>'<link><linkclipref>'+xml(e.id)+'</linkclipref><mediatype>'+e.clip.kind+'</mediatype><trackindex>'+e.track+'</trackindex><clipindex>'+e.index+'</clipindex><groupindex>1</groupindex></link>').join('');
  const audio=c.kind==='audio'?'<sourcetrack><mediatype>audio</mediatype><trackindex>'+lane.channel+'</trackindex></sourcetrack>'+audioLevels(c,fps):'';
  const media=c.kind==='video'?'<video><samplecharacteristics>'+rate(sourceRate)+'<width>'+c.width+'</width><height>'+c.height+'</height><anamorphic>FALSE</anamorphic><pixelaspectratio>square</pixelaspectratio><fielddominance>none</fielddominance></samplecharacteristics></video>':'<audio><samplecharacteristics><depth>16</depth><samplerate>48000</samplerate></samplecharacteristics><channelcount>2</channelcount></audio>';
  return '<clipitem id="'+xml(entry.id)+'"><name>'+xml(c.name)+'</name><enabled>'+(c.enabled?'TRUE':'FALSE')+'</enabled><duration>'+Math.max(1,Math.round((c.end-c.start)*sourceRate))+'</duration>'+rate(sourceRate)+'<start>'+Math.round(c.start*fps)+'</start><end>'+Math.round(c.end*fps)+'</end><in>'+Math.round(c.sourceIn*sourceRate)+'</in><out>'+Math.round(c.sourceOut*sourceRate)+'</out><file id="file-'+xml(c.id)+'"><name>'+xml(c.name)+'</name><pathurl>'+xml(pathToFileURL(c.path).href)+'</pathurl>'+rate(sourceRate)+'<duration>'+durationFrames+'</duration><media>'+media+'</media></file>'+audio+links+'</clipitem>';
 }).join('')+'</track>').join('');
 return '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE xmeml>\n<xmeml version="5"><sequence id="dream-sequence"><name>'+xml(name)+'</name><duration>'+Math.round(duration*fps)+'</duration>'+rate(fps)+'<timecode>'+rate(fps)+'<string>00:00:00:00</string><frame>0</frame><displayformat>NDF</displayformat></timecode><media><video><format><samplecharacteristics>'+rate(fps)+'<width>'+width+'</width><height>'+height+'</height><anamorphic>FALSE</anamorphic><pixelaspectratio>square</pixelaspectratio><fielddominance>none</fielddominance></samplecharacteristics></format>'+track('video')+'</video><audio><numOutputChannels>2</numOutputChannels>'+track('audio')+'</audio></media></sequence></xmeml>\n';
}
function audioLevels(c:ExchangeClip,fps:number){
 const gain=Math.pow(10,(c.gainDb??0)/20),length=c.end-c.start,start=Math.round(c.sourceIn*fps);
 const points=c.automation??[{timeSec:0,value:c.fadeInSec?0:gain},{timeSec:Math.min(length,c.fadeInSec??0),value:gain},{timeSec:Math.max(0,length-(c.fadeOutSec??0)),value:gain},{timeSec:length,value:c.fadeOutSec?0:gain}];
 const unique=new Map(points.map(p=>[start+Math.round(p.timeSec*fps),p.value]));
 const keys=[...unique].sort((a,b)=>a[0]-b[0]).map(([when,value])=>'<keyframe><when>'+when+'</when><value>'+value+'</value><interp>linear</interp></keyframe>').join('');
 return '<filter><effect><name>Audio Levels</name><effectid>audiolevels</effectid><effectcategory>audiolevels</effectcategory><effecttype>audio</effecttype><mediatype>audio</mediatype><parameter><parameterid>level</parameterid><name>Level</name><valuemin>0</valuemin><valuemax>4</valuemax><value>'+gain+'</value>'+keys+'</parameter></effect></filter>';
}
