import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import type {ProjectDB} from '@dream/project-db';
import type {ProcessRunner} from '@dream/contracts';

export const starterNodePackages={react:'19.1.1','react-dom':'19.1.1',three:'0.180.0',gsap:'3.13.0',esbuild:'0.25.12',remotion:'4.0.533',sharp:'0.34.4','opentype.js':'1.3.4',d3:'7.9.0','simplex-noise':'4.0.3'};
export const starterPythonPackages=['numpy==2.2.6','Pillow==11.3.0','scipy==1.16.2','opencv-python-headless==4.12.0.88','soundfile==0.13.1'];

/** Shared editing libraries ship with Gumbo. New projects need no installation. */
export async function prepareProjectPackages(db:ProjectDB,_run:ProcessRunner,_publish:(type:string,payload:any)=>void,signal:AbortSignal){
 signal.throwIfAborted();db.setMeta('editing_libraries','shared-v1');
}
