import {it,expect} from 'vitest';
import {chooseModel,estimateRtf,LOCAL_RTF,type Capabilities} from '../src';

const laptop:Capabilities={webgpu:true,shaderF16:true,adapter:{vendor:'intel',architecture:'gen-12lp',fallback:false},maxBufferMB:2048,deviceMemoryGB:16,cores:12,crossOriginIsolated:true};

it('puts the encoder on the GPU and the decoder on the CPU, and picks small only with room to spare',()=>{
 expect(chooseModel(laptop)).toMatchObject({size:'small',repo:'onnx-community/whisper-small_timestamped',device:'webgpu',decoderDevice:'wasm',encoder:'fp16',decoder:'q8',downloadMB:337});
 expect(chooseModel({...laptop,cores:4})).toMatchObject({size:'base',device:'webgpu',decoderDevice:'wasm',downloadMB:98});
 expect(chooseModel({...laptop,deviceMemoryGB:4}).size).toBe('base');
 // No fp16 on the GPU: full precision there, a bigger download, and base.
 expect(chooseModel({...laptop,shaderF16:false})).toMatchObject({size:'base',encoder:'fp32',decoder:'q8',downloadMB:140});
});

it('falls back to the CPU without WebGPU or with only a software adapter, and honours overrides',()=>{
 const none:Capabilities={webgpu:false,shaderF16:false,cores:8,crossOriginIsolated:true};
 expect(chooseModel(none)).toMatchObject({size:'base',device:'wasm',decoderDevice:'wasm',encoder:'q8',decoder:'q8',downloadMB:80});
 expect(chooseModel({...laptop,adapter:{...laptop.adapter!,fallback:true}}).device).toBe('wasm');
 expect(chooseModel(laptop,{size:'base',decoderDevice:'webgpu'})).toMatchObject({size:'base',device:'webgpu',decoderDevice:'webgpu',decoder:'q4f16',downloadMB:113});
});

it('estimates speed from encoder time and token time, and draws the cloud line at half real time',()=>{
 // Measured on the laptop above: base hybrid 0.61 s + 60 ms a token → 0.28 (ran at 0.25); small CPU 5.2 s + 143 ms → 0.81.
 expect(estimateRtf(605,60.2)).toBeCloseTo(.28,2);expect(estimateRtf(5152,142.6)).toBeGreaterThan(LOCAL_RTF);
});
