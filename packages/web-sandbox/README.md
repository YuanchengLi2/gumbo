# @dream/web-sandbox

Roux's `run_command` in the browser. A Web Worker runs a POSIX shell over the project's files. The Unix tools are
JavaScript, and the programs are WebAssembly: Python is Pyodide, `ffmpeg`/`ffprobe` are ffmpeg.wasm, and `esbuild` is
esbuild-wasm. `node` is a CommonJS runtime inside the worker. Nothing leaves the computer, except the wasm parts and
Python wheels when they are fetched from a CDN.

## Plugging it in

```ts
// sandbox-worker.ts in apps/web: the project's files through ZenFS (OPFS)
import {configure, fs} from '@zenfs/core';
import {serveSandbox, fromZenFS} from '@dream/web-sandbox';
serveSandbox(async () => { await configure({/* OPFS mounts */}); return fromZenFS(fs, '/projects/' + projectId); });

// main thread or project worker
import {SandboxClient} from '@dream/web-sandbox';
const sandbox = new SandboxClient({
  createWorker: () => new Worker(new URL('./sandbox-worker.ts', import.meta.url), {type: 'module'}),
  options: {workspace: '/Workspace', logDir: '/.dream/processes', assets: {/* see below */}},
});
await sandbox.runCommand({command: 'ffprobe -v error -show_format clip.mp4', cwd: '.', timeoutMs: 600000});
// or, where project-service expects the desktop's ProcessRunner:
const run = sandbox.runner(); // (request, signal, onOutput) => Promise<ProcessResult>
```

`runCommand` follows the run_command tool. A command that is still running after 4 minutes (`waitMs`) comes back as
`{status:'running', id}` with a note. You can then wait again with `{processId}` or end it with `{processId, stop:true}`.
`timeoutMs` cancels the command and says why. Output keeps its last 12,000 characters, as the desktop host does, and
`logDir` keeps the full log. The memory guard stops a command whose programs' wasm heaps and in-memory files grow past
`memoryLimitBytes`. The default is 60% of `navigator.deviceMemory`, at least 1.5 GB and at most 4 GB.

A program that keeps the worker busy cannot hear a stop message. The client handles this case itself:
- Python is interrupted through a SharedArrayBuffer and raises `KeyboardInterrupt`.
- Anything else still running after `graceMs` (3 s) gets the worker terminated and restarted. With an in-memory file
  system, that loses the files. With ZenFS/OPFS, the files stay.

## File system

`SandboxFS` (src/fs/types.ts) is a small synchronous interface, because Pyodide's and ffmpeg's file calls are
synchronous (Emscripten). The package includes three implementations:
- `MemoryFS`, for tests and the default worker.
- `fromZenFS(fs, folder)`, for the web app.
- `nodeLikeFS(fs)`, for anything with node's sync API.

All three pass the same conformance tests. Pyodide and ffmpeg read and write the sandbox's files directly through an
Emscripten file system (src/programs/emscripten-fs.ts). Nothing is copied in or out.

## Hosting the wasm parts

Each part loads on its first use and is cached by the browser after that. By default, every part comes from jsDelivr at
the pinned versions. To self-host one, copy its folder and pass its URL in `assets`:

| asset option | copy from | raw | gzip | brotli |
|---|---|---|---|---|
| (the worker bundle itself) | built from `src/sandbox.worker.ts` | 0.46 MB | 0.12 MB | |
| `pyodide` | `node_modules/pyodide/`: asm.wasm 9.2 MB, stdlib zip 2.4 MB, asm.mjs 1.2 MB, lock 0.1 MB | 12.9 MB | 6.1 MB | 5.2 MB |
| `pyodidePackages` | wheels, on import: numpy 2.8 MB, Pillow 1.0 MB, micropip for pip | per package | (already zipped) | |
| `ffmpegMt` (`ffmpeg` single-thread is about the same) | `@ffmpeg/core-mt/dist/esm/` | 31.3 MB | 9.9 MB | 7.0 MB |
| `esbuildWasm`, `esbuildModule` | `esbuild-wasm/esbuild.wasm`, `esm/browser.min.js` | 11.8 MB | 3.1 MB | 2.2 MB |

First use in headless Chromium from localhost with no cache:
- Python: 1.9 s.
- numpy + Pillow: 0.9 s warm, and 6.3 s the first time from the CDN.
- ffmpeg: 0.6 s, including 40 thread workers.
- esbuild: 0.8 s.
- Each later run is milliseconds.

A help or version option in ffmpeg (`-version`, `-encoders` …) makes the next ffmpeg run load a fresh core, which takes
about a second. ffmpeg.wasm keeps the help log callback after such a run, so without the reload every later run would
ignore `-v`.

ffmpeg sees at most 4 cores. Before each run, its pool is topped up to 40 loaded thread workers, because a thread
beyond the pool would deadlock the blocked worker.

Threads (ffmpeg-core-mt) and Python interrupts need the page to be cross-origin isolated. The app's headers must
include `Cross-Origin-Opener-Policy: same-origin` and `Cross-Origin-Embedder-Policy: require-corp`. Without isolation,
the single-thread ffmpeg is used, and only a hard restart can stop a stuck Python command.

## Tests

- `pnpm --filter @dream/web-sandbox test` runs vitest under Node. It covers the parser, the shell, every Unix tool,
  the process semantics, the file systems (memory, node:fs, ZenFS), and Python, esbuild and node. Pyodide and
  esbuild-wasm also run under Node.
- `pnpm --filter @dream/web-sandbox test:browser` runs Playwright in headless Chromium. It covers python, numpy and
  Pillow, ffmpeg with a transcode, esbuild and node in the real worker, a Python interrupt, background and stop, and a
  worker restart. It also writes the bytes each lazy part sends to `test-results/browser-sizes.json`.
