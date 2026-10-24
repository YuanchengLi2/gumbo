import {describe,expect,it} from 'vitest';
import {watermarkLayer,watermarked,WATERMARK_SECONDS} from '../../apps/desktop/src/renderer/engine/watermark';

describe('the free plan watermark',()=>{
 it('marks everyone but a paid plan',()=>{
  expect([undefined,'free','','guest'].map(watermarked)).toEqual([true,true,true,true]);
  expect(['pro','max','max20'].map(watermarked)).toEqual([false,false,false]);
 });
 it('shows only over the last seconds, fading in, inside the bottom-right corner',()=>{
  const duration=12,start=duration-WATERMARK_SECONDS;
  expect(watermarkLayer(start-.01,duration,1920,1080)).toBeUndefined();
  const first=watermarkLayer(start,duration,1920,1080)!,later=watermarkLayer(duration-.1,duration,1920,1080)!;
  expect(first.opacity).toBe(0);expect(later.opacity).toBeCloseTo(.88);
  expect(later.text).toBe('Edited with Gumbo');
  for(const [w,h] of [[1920,1080],[1080,1920],[1080,1080]]){const m=watermarkLayer(duration,duration,w,h)!;
   expect(m.x).toBeGreaterThan(.5);expect(m.x).toBeLessThan(1);expect(m.y).toBeGreaterThan(.85);expect(m.y).toBeLessThan(1);
   expect(m.fontSize).toBe(Math.round(Math.min(w,h)*.03));}
 });
 it('covers a clip shorter than the mark from the start',()=>{expect(watermarkLayer(0,1.5,1280,720)).toBeDefined();});
});
