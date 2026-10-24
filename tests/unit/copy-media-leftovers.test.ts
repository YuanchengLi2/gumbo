import {it,expect} from 'vitest';
import {mkdtempSync,readdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {copyMedia} from '../../apps/project-service/src/media-io';

/** On October 24 a project held two partial copies of one clip: a browser reload had cut off the first copy, and its
 * file stayed. A new copy of the same file clears its own leftovers and leaves every other file alone. */
it('a copy removes partial copies an interrupted copy of the same file left behind',async()=>{
 const folder=mkdtempSync(join(tmpdir(),'copy-media-')),source=join(folder,'source.mp4'),destination=join(folder,'a1-source.mp4');
 writeFileSync(source,'footage');
 writeFileSync(destination+'.0b5c.copying','partial');writeFileSync(join(folder,'a2-other.mp4.77aa.copying'),'another clip');
 await copyMedia(source,destination);
 expect(readdirSync(folder).sort()).toEqual(['a1-source.mp4','a2-other.mp4.77aa.copying','source.mp4']);
 expect(readFileSync(destination,'utf8')).toBe('footage');
});
