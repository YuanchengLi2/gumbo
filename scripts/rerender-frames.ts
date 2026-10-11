/** Renders frames of a project's published timeline again with the current composition bundle and scene engine, without
 * any model calls. Useful after an engine fix: pnpm exec tsx scripts/rerender-frames.ts <project folder> [prefix] */
import {writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {ProjectDB} from '@dream/project-db';
import {resolve as resolveTimeline} from '@dream/timeline';
import {renderReview} from '../apps/desktop/src/main/review-rendering';

const folder=resolve(process.argv[2]??''),prefix=process.argv[3]??'rerender',staged=resolve('apps/desktop/resources/staged');
const project=new ProjectDB(folder);
try{
 const timeline=project.timeline(),footage=project.footage(),total=resolveTimeline(timeline,footage).durationInFrames,count=Math.min(8,total);
 const picks=Array.from({length:count},(_,i)=>Math.min(total-1,Math.round((i+.5)*total/count)));
 const images=await renderReview({versionId:project.head(),timeline,footage,frames:picks.map(frame=>({frame,labels:[]}))},{renderBundle:join(staged,'remotion'),browser:join(staged,'render-browser/chrome-headless-shell.exe'),binariesDirectory:join(staged,'compositor'),cacheDirectory:join(folder,'.dream/review-cache-'+Date.now()),engineRuntime:join(staged,'engine')},new AbortController().signal);
 for(const image of images.frames){const file=join(folder,`${prefix}-frame-${String(image.frame).padStart(5,'0')}.jpg`);writeFileSync(file,Buffer.from(image.data,'base64'));console.log(file);}
}finally{project.close();}
