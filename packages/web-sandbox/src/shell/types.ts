import type {SandboxFS} from '../fs/types';
import type {Input,Output} from './io';

export interface IO{in:Input;out:Output;err:Output}
/** What a command gets: its arguments, streams, folder, environment and the file system. Tools are plain async functions
 * of this, so each can be tested alone against the in-memory file system. */
export interface CommandContext{
 name:string;args:string[];
 stdin:Input;stdout:Output;stderr:Output;
 cwd:string;env:Record<string,string>;
 fs:SandboxFS;signal:AbortSignal;
 /** An absolute path for a path the user gave, relative to the command's folder. */
 resolve(path:string):string;
 /** Runs another command (xargs, find -exec, env, timeout) with these or other streams. */
 exec(argv:string[],io?:Partial<IO>&{cwd?:string;env?:Record<string,string>;signal?:AbortSignal}):Promise<number>;
 /** Runs a shell script (sh -c, sh file.sh) as a child shell with these streams. */
 script(source:string,options?:{args?:string[];name?:string;io?:Partial<IO>;cwd?:string;env?:Record<string,string>;flags?:string}):Promise<number>;
 out(text:string):Promise<void>;
 err(text:string):Promise<void>;
 host:Host;
}
export type Command=(ctx:CommandContext)=>Promise<number>;
/** The sandbox around the shell: lazy programs and what they need from the page. */
export interface Host{
 commands:Map<string,Command>;
 /** Names that answer "not available here" with a reason (npm, apt, sudo …). */
 unavailable:Record<string,string>;
 fetch?:typeof fetch;
 /** Milliseconds left before the command's time limit, so ffmpeg can stop itself in time. */
 timeLeft():number;
 /** Programs' wasm heaps and other memory they hold, for the memory guard. */
 reportMemory(name:string,bytes:()=>number):void;
 /** Shared memory a stop writes to, so Python can raise KeyboardInterrupt while it runs. */
 interrupt?:Int32Array;
 workspace:string;
 [key:string]:unknown;
}
/** Thrown by a command that wants to leave with a status (usage errors), printed as "name: message". */
export class CommandError extends Error{constructor(message:string,public status=1){super(message);}}
