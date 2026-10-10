import {resolve,join} from 'node:path';
import {writeFileSync,mkdirSync} from 'node:fs';
import {ProjectDB} from '@dream/project-db';
import {reviewPacket} from '../packages/orchestrator/src/review-packet';
import {renderReview} from '../apps/desktop/src/main/review-rendering';
import {frameDifference} from '../tests/fixtures/frame-fidelity';

const db=new ProjectDB(resolve('artifacts/Smoke Project'));const state=db.state();db.close();
const staged=resolve('apps/desktop/resources/staged');
const runtime={renderBundle:join(staged,'remotion'),browser:join(staged,'render-browser/chrome-headless-shell.exe'),binariesDirectory:join(staged,'compositor'),cacheDirectory:resolve('artifacts/review-cache'),engineRuntime:join(staged,'engine')};
const packet=reviewPacket(state.versionId,state.timeline,state.footage),started=Date.now();
const images=await renderReview(packet.request,runtime,new AbortController().signal);
mkdirSync('artifacts/review-frames',{recursive:true});
for(const frame of images.frames)writeFileSync(`artifacts/review-frames/${frame.frame}.jpg`,Buffer.from(frame.data,'base64'));
const firstFrameDifference=frameDifference(join(staged,'media-runtime/ffmpeg.exe'),state.footage.assets[0].originalPath,resolve('artifacts/review-frames/0.jpg'));
const report={passed:images.frames.length===packet.request.frames.length&&firstFrameDifference<8,firstFrameDifference,versionId:state.versionId,elapsedMs:Date.now()-started,frames:images.frames.map(({data,...f})=>f),evidence:packet.evidence};
writeFileSync('artifacts/rendered-review-acceptance.json',JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,frameCount:images.frames.length,elapsedMs:report.elapsedMs}));
if(!report.passed)process.exitCode=1;
