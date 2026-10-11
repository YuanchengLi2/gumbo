import {it,expect} from 'vitest';
import {emptyTimeline} from '@dream/timeline';
import {clipStyle,gradeFilter,whiteBalances,whiteBalanceId,whiteBalanceMatrix} from '../../packages/composition/src/visual-style';

it('warms and cools with a colour matrix instead of turning every hue',()=>{
 // Checked in the app's render browser: grey 128 becomes 144,131,112 at 0.5 and 112,125,144 at -0.5.
 expect(whiteBalanceMatrix(.5)).toBe('1.125 0 0 0 0 0 1.02 0 0 0 0 0 0.875 0 0 0 0 0 1 0');expect(whiteBalanceMatrix(-.5)).toBe('0.875 0 0 0 0 0 0.98 0 0 0 0 0 1.125 0 0 0 0 0 1 0');
 const warm=String(clipStyle({mode:'fit',scale:1,x:.5,y:.5,temperature:.3}).filter),neutral=String(clipStyle({mode:'fit',scale:1,x:.5,y:.5}).filter);
 expect(warm).toContain(`url(#${whiteBalanceId(.3)})`);expect(warm).not.toMatch(/sepia|hue-rotate/);expect(neutral).not.toContain('url(');
 expect(gradeFilter({temperature:-.4})).toContain(`url(#${whiteBalanceId(-.4)})`);
});

it('defines one filter for each temperature the clips and grade layers use',()=>{
 const t=emptyTimeline('t');
 t.spine=[{id:'a',assetId:'v',srcIn:0,srcOut:2,speed:1,audio:{gainDb:0,fadeInSec:.01,fadeOutSec:.01,mute:false},reason:'',framing:{mode:'fit',scale:1,x:.5,y:.5,temperature:.3}},{id:'b',assetId:'v',srcIn:2,srcOut:4,speed:1,audio:{gainDb:0,fadeInSec:.01,fadeOutSec:.01,mute:false},reason:'',framing:{mode:'fit',scale:1,x:.5,y:.5,temperature:.301}}];
 t.attached=[{id:'g',type:'effect',component:'grade',start:{kind:'project',at:'start',offsetSec:0},durationSec:4,params:{temperature:-.2},layer:0,reason:''}];
 expect(whiteBalances(t).sort()).toEqual([-.2,.3]);
});
