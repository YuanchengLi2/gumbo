import type {Command} from '../shell/types';
import {python,pip} from './python';
import {ffmpeg,ffprobe} from './ffmpeg';
import {node,npx} from './node';
import {esbuild} from './esbuild';

/** The programs, each loaded on first use: Pyodide, ffmpeg.wasm and esbuild-wasm are fetched only when a command needs them. */
export const programs:Record<string,Command>={python,python3:python,pip,pip3:pip,ffmpeg,ffprobe,node,nodejs:node,tsx:node,esbuild,npx};
