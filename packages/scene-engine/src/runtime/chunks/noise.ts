import * as SimplexNoise from 'simplex-noise';
import * as RemotionNoise from '@remotion/noise';

const registry=(globalThis as any).DreamEngine;
registry.define('simplex-noise',()=>SimplexNoise);
registry.define('@remotion/noise',()=>RemotionNoise);
