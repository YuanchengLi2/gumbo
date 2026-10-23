# @dream/web-ml

Local speech recognition for the web app: Whisper (transformers.js 4.3.1 on ONNX Runtime Web) in a Web Worker. The
encoder runs on WebGPU when there is one and the token-by-token decoder on the CPU (WASM), which measured faster than
an integrated GPU for that part; without WebGPU everything runs on the CPU. Audio never leaves the browser.

## Use

```ts
import {LocalWhisper,localWords} from '@dream/web-ml';

const whisper=new LocalWhisper(undefined,{wasmPaths:'/ort/'}); // worker created with Vite's new URL(…, import.meta.url)
const {capabilities,choice,cached}=await whisper.capabilities();   // instant: WebGPU? which model? downloaded yet?
const probe=await whisper.probe({sample:first30sOfPcm});           // loads the model, times it: probe.verdict 'local' | 'cloud'

const stream=whisper.stream({durationSec,onWords:words=>save(localWords(asset.id,words)),onProgress,signal});
for await(const pcm of decodeTo16kMono(file))await stream.push(pcm); // waits when the worker has enough queued
const result=await stream.end();                                     // LocalSpeechResult
```

- **Input:** 16 kHz mono `Float32Array` PCM in any chunk size (`wavToPcm` reads the project service's PCM16 WAV chunks).
- **Output:** `LocalSpeechResult` is the gateway `transcribe` route's `SpeechResult` (`words:{word,start,end}[]`,
  `segments` with `avg_logprob`/`no_speech_prob`, `language` as Groq names it, e.g. `"english"`) plus `languageCode`,
  per-word `probability`, `model`, `device`, `rtf`. So it can replace the cloud call in `CloudSpeech`: either
  `cloudWords(assetId,{index:0,start:0,end:d,decodeStart:0,decodeEnd:d},result,d,mask)` (keeps `fitToSpeech`), or
  `localWords(assetId,result.words)` for stored `Word`s directly.
- **Models:** `onnx-community/whisper-{base,small}_timestamped` (exports with cross-attentions, needed for word times),
  cached by transformers.js in the Cache API (`transformers-cache`, per origin); `capabilities()` says whether they
  are there. small where WebGPU with fp16, 8+ GB and 8+ cores suggest it can keep up, else base. `probe()` measures the
  pick; if small is slower than half real time it tries base, and if base is too, `verdict` is `'cloud'`. Later
  transcriptions in the worker use what the probe settled on.
- **Cancel:** `stream.cancel()` or an `AbortSignal`; decoding stops at the next token and the worker frees the audio.

## How it works

- `Windower` cuts the stream into 30 s windows overlapping by 4 s and keeps only audio not yet handed out (one window
  plus what was pushed). Clients wait on `push` while more than 60 s is in flight, so audio in memory stays under ~6 MB
  however long the file.
- Each window is one encoder pass. Decoding starts after `<|startoftranscript|>` so the model names the language itself
  (transformers.js would assume English), and the same step gives Whisper's no-speech probability. Then Whisper's own
  timestamp rules (segments `<|0.00|> text <|2.40|>`): without them Whisper often stops after one sentence of a window
  that starts mid-speech (it kept 185 of 268 words of the test speech). Word times come from cross-attention + DTW
  (OpenAI's alignment) kept inside their segment, punctuation takes no time, and each word carries its probability.
- Seams: the two takes of the overlap are aligned word by word (text equal, about the same time); the longest agreeing
  run anchors the hand-over at its word nearest the overlap's quietest moment. With nothing in common, each side keeps
  its half, and a word only one side heard is kept.
- Silent windows are not decoded (Whisper invents "Thank you." for silence); a window Whisper itself calls no-speech
  is dropped; decoding loops ("and the and the …") are collapsed.

## Hosting

The page must be cross-origin isolated (`COOP: same-origin`, `COEP: require-corp`) for multi-threaded WASM. Serve
ONNX Runtime's files from the app (`wasmPaths`) rather than the CDN transformers.js defaults to: the build fetches
`ort-wasm-simd-threaded.asyncify.mjs` and `.wasm` from `node_modules/onnxruntime-web/dist`. Model files come from
huggingface.co, which sends CORS headers, so they load under COEP.

## Measured (October 22, 2026)

Intel Core i5-1235U laptop (Iris Xe, 16 GB), Chromium 153 headless, cross-origin isolated, 4 WASM threads, while other
work shared the CPU. 90 s of TTS speech (the Gettysburg Address, 268 words); best of two runs. RTF is processing time
over audio time; WER is word error against the text (case and punctuation aside).

| Model | Encoder | Decoder | Download | Encoder / window | Decoder / token | RTF | WER |
|---|---|---|---|---|---|---|---|
| base | WebGPU fp16 | WebGPU q4f16 | 113 MB | 0.49 s | 68 ms | 0.29 | 1.1% |
| base | WebGPU fp16 | CPU q8 | 98 MB | 0.61 s | 60 ms | **0.25** | 1.9% |
| base | CPU q8 | CPU q8 | 80 MB | 1.6 s | 49 ms | 0.27 | 2.2% |
| small | WebGPU fp16 | WebGPU q4f16 | 326 MB | 1.4 s | 116 ms | 0.66 | 0.4% |
| small | WebGPU fp16 | CPU q8 | 337 MB | 1.5 s | 106 ms | **0.52** | 0.4% |
| small | CPU q8 | CPU q8 | 252 MB | 5.2 s | 143 ms | 0.63 | 0.4% |

Every row detected English, and Chinese for the Chinese clip. Loads from the Cache API take 2–5 s; first downloads ran
at 1–2 MB/s here. The only small error was "honoured" for "honored". The probe's estimate (from a timed noise decode)
lands within ~25% of the measured RTF. TTS speech is clean: expect more errors, and a wider base/small gap, on real
footage.

## Tests

- `pnpm test`: windowing, seams, merging, loop collapsing, the stream with a simulated Whisper (Node, fast).
- `pnpm test:browser`: headless Chromium transcribes `test/fixtures` (see its README for licenses) through the real
  worker on WebGPU and on WASM, checks accuracy, timing and seams, cancellation, the probe and language detection.
  `WEB_ML_MATRIX=1` also measures every model on every device (`test-results/matrix.json`).
