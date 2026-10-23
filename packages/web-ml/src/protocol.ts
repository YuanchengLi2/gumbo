import type {CapabilityReport,LocalSpeechResult,LocalWord,ModelChoice,ModelSize,Device,ProbeResult,Progress,TranscribeOptions} from './types';

export type Override={size?:ModelSize;device?:Device;decoderDevice?:Device};
/** Main thread → ML worker. `id` pairs a request with its replies; a transcription keeps its id from start to end. */
export type Request=
 |{type:'configure';id:number;wasmPaths?:string}
 |{type:'capabilities';id:number;override?:Override}
 |{type:'probe';id:number;override?:Override;sample?:Float32Array}
 |{type:'load';id:number;override?:Override}
 |{type:'start';id:number;override?:Override;options:TranscribeOptions}
 |{type:'audio';id:number;pcm:Float32Array}
 |{type:'end';id:number}
 |{type:'cancel';id:number};
/** ML worker → main thread. `buffer` says how many samples a transcription has taken in and still holds, for
 * back-pressure: the client stops sending while too much audio is in flight or waiting for a window. */
export type Reply=
 |{type:'reply';id:number;value:CapabilityReport|ProbeResult|(ModelChoice&{loadMs:number})|LocalSpeechResult|null}
 |{type:'error';id:number;error:{name:string;message:string}}
 |{type:'progress';id:number;progress:Progress}
 |{type:'words';id:number;words:LocalWord[]}
 |{type:'buffer';id:number;received:number;buffered:number};
