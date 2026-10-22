/** Local speech recognition for the web app: Whisper in a Web Worker on WebGPU (WASM when there is none). The main
 * thread uses `LocalWhisper`; the worker module is `./ml.worker.ts` (exported as `@dream/web-ml/worker`). */
export {LocalWhisper,TranscriptionStream,type StreamOptions} from './client';
export {StreamTranscription,type StreamResult} from './stream';
export {Windower,quietestPoint,speechFraction,wavToPcm,pcm16ToFloat32,type AudioWindow,type Seam} from './chunking';
export {mergeSeam,collapseRepeats,normalizeWord} from './merge';
export {chooseModel,modelChoice,precision,estimateRtf,LOCAL_RTF,MODELS} from './device';
export {localWords} from './words';
export {LANGUAGES,languageCode,languageName} from './languages';
export type {Override} from './protocol';
export * from './types';
