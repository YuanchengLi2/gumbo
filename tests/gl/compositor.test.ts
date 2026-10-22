import {it,expect} from 'vitest';
import {execFileSync,spawnSync} from 'node:child_process';
import {join,resolve} from 'node:path';
import {createRequire} from 'node:module';
/** The compositor's actual pixels in Electron's Chromium (WebGL2): placement, transform, opacity, grade, scale and text. */
it('draws media, transforms, opacity, grades, canvas scaling and text as the frame model says',()=>{
 const dir=resolve('tests/gl'),require_=createRequire(import.meta.url);
 execFileSync(process.execPath,[require_.resolve('esbuild/bin/esbuild'),join(dir,'harness.ts'),'--bundle','--format=iife','--outfile='+join(dir,'harness.js'),'--log-level=error']);
 const electron=require_('electron') as unknown as string,cases=['plain','zoom','moved','graded','grey','scaled','text','maskRect','maskCircle','hue','fade','split','vignette','pixel','sticker','tint','maskEdge','maskClock','stripes','burn','leak','streak','zoomBlur'];
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
 // Masks: the left half is cut away by the rectangle; the circle keeps the middle and not the corner.
 expect(near(r.maskRect.left,[0,0,0])&&near(r.maskRect.right,[0,0,255])).toBe(true);
 expect(near(r.maskCircle.middleLeft,[255,0,0])&&near(r.maskCircle.corner,[0,0,0])&&near(r.maskCircle.left,[0,0,0])).toBe(true);
 // Hue 120° on red is CSS's hue-rotate: (0, 113, 0). A full fade: 0.22 + 0.7 × the colour.
 expect(near(r.hue.left,[0,113,0])).toBe(true);expect(near(r.fade.left,[235,56,56])).toBe(true);
 // Split: 5 px left of the edge the red channel comes from the blue half and the blue channel from the red: black.
 expect(near(r.split.middleLeft,[0,0,0])&&near(r.split.left,[255,0,0])).toBe(true);
 expect(r.vignette.left[0]).toBeLessThan(120);expect(r.vignette.middleLeft[0]).toBeGreaterThan(200);
 // 80 px blocks: x = 95 falls in the block from 80 to 160, whose middle is blue.
 expect(near(r.pixel.middleLeft,[0,0,255])).toBe(true);
 // The heart's red fills the middle (a little below centre, clear of its highlight); the corner stays black.
 expect(near(r.sticker.centre,[255,0,0])&&near(r.sticker.corner,[0,0,0])).toBe(true);
 // Tint 1 (magenta) lifts red and blue by 10% and lowers green: red halved by exposure -1 becomes 0.55 of full.
 expect(near(r.tint.left,[140,0,0])).toBe(true);
 // The transition masks keep only their part of the layer.
 expect(near(r.maskEdge.left,[0,0,0])&&near(r.maskEdge.right,[0,0,255])).toBe(true);
 expect(near(r.maskClock.left,[0,0,0])&&near(r.maskClock.right,[0,0,255])).toBe(true);
 expect(near(r.stripes.left,[255,0,0])&&near(r.stripes.right,[0,0,0])&&near(r.stripes.middleLeft,[0,0,0])).toBe(true);
 // Burn, leak and the blurs.
 expect(Math.min(...r.burn.left,...r.burn.right)).toBeGreaterThan(200);
 expect(r.leak.right[0]).toBeGreaterThan(40);expect(r.leak.right[2]).toBeGreaterThan(200);
 expect(r.streak.middleLeft[0]).toBeGreaterThan(60);expect(r.streak.middleLeft[2]).toBeGreaterThan(60);expect(near(r.streak.left,[255,0,0])).toBe(true);
 expect(r.zoomBlur.at140[0]).toBeGreaterThan(30);expect(r.zoomBlur.at140[2]).toBeGreaterThan(100);
},90_000);
