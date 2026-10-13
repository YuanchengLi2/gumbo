import {it,expect} from 'vitest';
import {execFileSync,spawnSync} from 'node:child_process';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
/** The compositor's actual pixels in Electron's Chromium (WebGL2): placement, transform, opacity, grade, scale and text. */
it('draws media, transforms, opacity, grades, canvas scaling and text as the frame model says',()=>{
 const dir=resolve('tests/gl'),require_=createRequire(import.meta.url);
 execFileSync(process.execPath,[require_.resolve('esbuild/bin/esbuild'),join(dir,'harness.ts'),'--bundle','--format=iife','--outfile='+join(dir,'harness.js'),'--log-level=error']);
 const electron=require_('electron') as unknown as string,cases=['plain','zoom','moved','graded','grey','scaled','text'];
 const run=spawnSync(electron,[join(dir,'main.cjs')],{env:{...process.env,CASES:cases.join(',')},encoding:'utf8',timeout:60000});
 const line=(run.stdout??'').split('\n').find(l=>l.startsWith('RESULT '));if(!line)throw new Error('Harness failed: '+run.stderr);
 const r=JSON.parse(line.slice(7)),near=(a:number[],b:number[])=>a.every((v,i)=>Math.abs(v-b[i])<=8);
 expect(near(r.plain.left,[255,0,0])&&near(r.plain.right,[0,0,255])).toBe(true);
 expect(r.zoom.middleLeft[0]).toBeGreaterThan(200);expect(near(r.zoom.middleRight,[0,0,255])&&near(r.zoom.left,[255,0,0])).toBe(true);
 // Moved right 50 px at half opacity over white: x=20 is white; x=60 shows red at half over white.
 expect(near(r.moved.left,[255,255,255])&&near(r.moved.edge,[255,128,128])).toBe(true);
 expect(near(r.graded.left,[128,0,0])).toBe(true);
 // Saturation 0 gives the luminance grey of red: 0.213 x 255.
 expect(near(r.grey.left,[54,54,54])).toBe(true);
 expect(near(r.scaled.left,[255,0,0])&&near(r.scaled.right,[0,0,255])).toBe(true);
 // A green box with white text at the centre; the corner is the black background.
 expect(near(r.text.corner,[0,0,0])).toBe(true);expect(r.text.middleLeft[1]).toBeGreaterThan(150);expect(near(r.text.edge,[0,0,0])).toBe(true);
},90_000);
