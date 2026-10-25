/** Following a subject through a stretch of footage: a vision model marks the subject (described in words) in frames
 * sampled across the range; the marks become a smooth path, gaps where it was not seen filled from either side; and the
 * path becomes keyframes that keep the subject in frame for any frame shape (a vertical Short of a wide shot, a
 * spotlight). Boxes are fractions of the source picture: x, y the box's centre from the left and top, w, h its size. */
export type Box={x:number;y:number;w:number;h:number};
export type TrackSample={at:number;box:Box|null};
export type Track={source:string;subject:string;start:number;end:number;seen:number;samples:TrackSample[];path:(Box&{at:number})[]};

/** What the vision model is asked: one box per frame in the convention Gemini is trained on. */
export const locateSystem=`You mark one subject in video frames for a video editor. For each frame give the subject's bounding box as [ymin, xmin, ymax, xmax], each from 0 to 1000 of the image's height and width, or null when the subject is not visible in that frame. The subject is described in words; when several things could match, keep to the same one in every frame. Reply with a JSON array only, one entry per frame in order: [{"frame": 1, "box": [ymin, xmin, ymax, xmax]}, {"frame": 2, "box": null}, ...]`;
/** The workspace's locate: the frames, each with its time, and the subject, asked of the model ask calls. */
export const locator=(ask:(content:unknown[],turnId:string,signal:AbortSignal)=>Promise<string>)=>async(frames:{data:string;at:number}[],subject:string,turnId:string,signal:AbortSignal)=>
 parseBoxes(await ask([{type:'text',text:`The subject: ${subject}. ${frames.length} frames.`},...frames.flatMap((f,i)=>[{type:'text',text:`Frame ${i+1} (${f.at} s):`},{type:'image',source:{type:'base64',media_type:'image/jpeg',data:f.data}}])],turnId,signal),frames.length);
/** The model's reply as one raw box (or null) per frame. */
export function parseBoxes(text:string,count:number):(unknown|null)[]{
 const out:(unknown|null)[]=new Array(count).fill(null),a=text.indexOf('['),b=text.lastIndexOf(']');if(a<0||b<a)return out;
 try{const rows=JSON.parse(text.slice(a,b+1));if(Array.isArray(rows))rows.forEach((r:any,i:number)=>{const n=Number.isInteger(r?.frame)?r.frame-1:i;if(n>=0&&n<count)out[n]=r?.box??null;});}catch{}
 return out;
}

/** How often to look: twice a second for a short range, never more than 240 frames for a long one. */
export function sampleTimes(start:number,end:number){
 const step=Math.max(.5,(end-start)/240),out:number[]=[];
 for(let t=start;t<=end-1e-6;t+=step)out.push(Math.round(t*1000)/1000);
 if(!out.length||end-out[out.length-1]>step/2)out.push(Math.round(end*1000)/1000);
 return out;
}

/** A model's box reply ([ymin, xmin, ymax, xmax] in thousandths, as Gemini gives them) as a Box, or null. */
export function boxFrom(value:unknown):Box|null{
 if(!Array.isArray(value)||value.length!==4||!value.every(v=>typeof v==='number'&&Number.isFinite(v)))return null;
 const [y0,x0,y1,x1]=value.map(v=>Math.max(0,Math.min(1000,v))/1000);
 if(x1-x0<.005||y1-y0<.005)return null;
 return{x:(x0+x1)/2,y:(y0+y1)/2,w:x1-x0,h:y1-y0};
}

const median=(values:number[])=>{const s=[...values].sort((a,b)=>a-b);return s[Math.floor(s.length/2)];};
/** The smooth path: a mark far from both neighbours is dropped as a misread; gaps are filled by straight lines between the
 * marks on either side (held before the first and after the last); then each value is the median of five around it and
 * eased forwards and back, so the frame glides instead of jittering. */
export function smoothPath(samples:TrackSample[]):(Box&{at:number})[]{
 const marks=samples.map(s=>s.box?{...s.box}:null);
 for(let i=1;i<marks.length-1;i++){const a=marks[i-1],b=marks[i],c=marks[i+1];if(a&&b&&c&&Math.hypot(b.x-a.x,b.y-a.y)>.25&&Math.hypot(b.x-c.x,b.y-c.y)>.25&&Math.hypot(a.x-c.x,a.y-c.y)<.15)marks[i]=null;}
 const known=marks.map((m,i)=>m?i:-1).filter(i=>i>=0);if(!known.length)return[];
 const filled=marks.map((m,i)=>{
  if(m)return m;const before=known.filter(k=>k<i).pop(),after=known.find(k=>k>i);
  if(before===undefined)return marks[after!]!;if(after===undefined)return marks[before]!;
  const f=(samples[i].at-samples[before].at)/(samples[after].at-samples[before].at),a=marks[before]!,b=marks[after]!;
  return{x:a.x+(b.x-a.x)*f,y:a.y+(b.y-a.y)*f,w:a.w+(b.w-a.w)*f,h:a.h+(b.h-a.h)*f};
 });
 const keys=['x','y','w','h'] as const,smoothed=filled.map((_,i)=>Object.fromEntries(keys.map(k=>[k,median(filled.slice(Math.max(0,i-2),i+3).map(b=>b[k]))])) as Box);
 for(const k of keys){for(let i=1;i<smoothed.length;i++)smoothed[i][k]=smoothed[i-1][k]*.4+smoothed[i][k]*.6;for(let i=smoothed.length-2;i>=0;i--)smoothed[i][k]=smoothed[i+1][k]*.4+smoothed[i][k]*.6;}
 const r4=(n:number)=>Math.round(n*1e4)/1e4;
 return smoothed.map((b,i)=>({at:samples[i].at,x:r4(b.x),y:r4(b.y),w:r4(b.w),h:r4(b.h)}));
}

/** Keyframes (project.json's sec, scale, x, y) that keep the path's subject centred in a frame of this size, at this zoom,
 * never showing past the picture's edge. The picture first fills the frame (as a clip whose framing mode is fill), is
 * scaled by scale about the frame's centre, then moved by (x - 0.5) and (y - 0.5) frame widths and heights. A keyframe
 * about every second, more where the subject moves. */
export function followKeyframes(path:(Box&{at:number})[],source:{width:number;height:number},frame:{width:number;height:number},zoom=1){
 const fill=Math.max(frame.width/source.width,frame.height/source.height),shownW=source.width*fill*zoom/frame.width,shownH=source.height*fill*zoom/frame.height;
 const limitX=(shownW-1)/2,limitY=(shownH-1)/2,r3=(n:number)=>Math.round(n*1000)/1000;
 const keys=path.map(p=>({sec:r3(p.at),scale:r3(zoom),x:r3(.5+Math.max(-limitX,Math.min(limitX,-(p.x-.5)*shownW))),y:r3(.5+Math.max(-limitY,Math.min(limitY,-(p.y-.5)*shownH)))}));
 const kept=keys.filter((k,i)=>i===0||i===keys.length-1||k.sec-keys[i-1].sec>=.99||Math.hypot(k.x-keys[i-1].x,k.y-keys[i-1].y)>.03);
 // Drop keyframes the line between their neighbours already passes close to.
 return kept.filter((k,i)=>{if(i===0||i===kept.length-1)return true;const a=kept[i-1],b=kept[i+1],f=(k.sec-a.sec)/(b.sec-a.sec||1);return Math.hypot(a.x+(b.x-a.x)*f-k.x,a.y+(b.y-a.y)*f-k.y)>.01||k.sec-a.sec>=2;});
}
