/** Whisper, on this computer: @dream/web-ml's worker (WebGPU when the computer has it, else WebAssembly; the model it can
 * keep up with, downloaded once from Hugging Face and kept in the browser's cache). Audio comes in, words go out. */
import '@dream/web-ml/worker';
