import {it,expect} from 'vitest';
import {compileVisual} from '../../apps/desktop/src/sandbox/compile';

it('transpiles full frame-based React scenes without executing their code',()=>{
 const code=compileVisual(`import React from 'react';import {useCurrentFrame,interpolate,AbsoluteFill} from 'remotion';throw new Error('must not execute during compilation');export default function Scene(){const f=useCurrentFrame();return <AbsoluteFill><svg><circle r={interpolate(f,[0,30],[0,120])}/></svg>{Array.from({length:100},(_,i)=><div key={i} style={{transform:'rotate('+f*i+'deg)'}}/>)}</AbsoluteFill>}`);
 expect(code).toContain('/runtime/remotion.js');expect(code).toContain('/runtime/jsx-runtime.js');expect(code).toContain('must not execute during compilation');expect(code).not.toContain('<AbsoluteFill>');
});
it('rejects filesystem/package/network module loading while preserving expressive scene code',()=>{
 for(const source of ["import fs from 'node:fs';", "import x from './local-file';", "import x from 'https://example.org/code.js';", "const x=import(name);", "const x=require('node:fs');"]){expect(()=>compileVisual(source)).toThrow();}
 expect(()=>compileVisual('export default function(){return <div>')).toThrow();
});
