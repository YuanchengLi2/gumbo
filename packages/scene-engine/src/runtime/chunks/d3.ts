import * as d3 from 'd3';
import {MODULES} from '../../modules';

const registry=(globalThis as any).DreamEngine;
// d3 re-exports every d3-* module, so each submodule name resolves to the same namespace.
for(const [name,chunk] of Object.entries(MODULES))if(chunk==='d3')registry.define(name,()=>d3);
