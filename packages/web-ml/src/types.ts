/** Whisper hears 16 kHz mono; every PCM sample in this package is at that rate. */
export const SAMPLE_RATE=16000;

export type ModelSize='base'|'small';
export type Device='webgpu'|'wasm';
export type DType='fp32'|'fp16'|'q8'|'q4'|'q4f16';
/** `device` runs the encoder (one big pass per window); `decoderDevice` the token-by-token decoder, which can be faster
 * on the CPU than on an integrated GPU. */
export type ModelChoice={size:ModelSize;repo:string;device:Device;decoderDevice:Device;encoder:DType;decoder:DType;downloadMB:number};
export type Task='transcribe'|'translate';

/** A word as heard: text with its punctuation, seconds from the start of the audio given, and the model's mean token
 * probability. The same {word,start,end} the gateway's transcribe route returns, so `cloudWords` reads it unchanged. */
export type LocalWord={word:string;start:number;end:number;probability:number;language:string};
/** One per window, tiling the audio: the gateway's segment shape (avg_logprob, no_speech_prob) plus the window's language. */
export type LocalSegment={start:number;end:number;avg_logprob:number;no_speech_prob:number;text:string;language:string};
/** The gateway's `SpeechResult` (apps/project-service/src/speech.ts) with what only a local run knows. `language` is the
 * lowercase Whisper name ("english"), as Groq reports it and project words store it; `languageCode` is the ISO code. */
export type LocalSpeechResult={words:LocalWord[];segments:LocalSegment[];language:string;languageCode:string;translated?:boolean;durationSec:number;model:string;device:Device;elapsedMs:number;rtf:number};

/** What one 30-second window decoded to; times are seconds from the window's first sample. */
export type WindowResult={words:{word:string;start:number;end:number;probability:number}[];language:string;languageProbability:number;noSpeechProb:number;avgLogprob:number;tokens:number;truncated:boolean;skipped?:'silent'|'no-speech'};
export type DecodeWindow=(samples:Float32Array,options:{language?:string;task:Task;signal:AbortSignal})=>Promise<WindowResult>;

export type DownloadProgress={file:string;loaded:number;total:number;progress:number};
export type Progress={stage:'download';files:DownloadProgress[];loaded:number;total:number}|{stage:'transcribe';seconds:number;durationSec?:number};

export type Capabilities={webgpu:boolean;shaderF16:boolean;adapter?:{vendor:string;architecture:string;fallback:boolean};maxBufferMB?:number;deviceMemoryGB?:number;cores:number;crossOriginIsolated:boolean};
export type CapabilityReport={capabilities:Capabilities;choice:ModelChoice;cached:boolean};
/** `verdict` is 'cloud' when local transcription would run slower than half real time, so the app should offer the
 * gateway's transcribe route instead. `rtf` is processing time over audio time (0.1 = ten times faster than real time). */
export type ProbeResult=CapabilityReport&{loadMs:number;encoderMs:number;tokenMs:number;rtf:number;measuredRtf?:number;verdict:'local'|'cloud';reason:string};

export type TranscribeOptions={language?:string;task?:Task;durationSec?:number;windowSec?:number;overlapSec?:number};
