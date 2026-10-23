/// The sandbox worker with an in-memory file system. Start it as a module worker:
///   new Worker(new URL('@dream/web-sandbox/worker', import.meta.url), {type: 'module'})
/// The web app makes its own one-line worker with serveSandbox(fromZenFS(…)) to work on the project's files in OPFS.
import {serveSandbox} from './serve';
serveSandbox();
