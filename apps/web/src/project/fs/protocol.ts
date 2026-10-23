/** The synchronous file system's channel between the project worker (which calls node:fs synchronously, as the desktop
 * project service does) and the storage worker (which owns the browser's asynchronous OPFS). One request is in flight at
 * a time: the caller posts it and waits on the shared buffer with Atomics.wait; the storage worker writes the answer and
 * wakes it. Layout: Int32 [signal, status, jsonLength, dataLength], then the JSON, then the bytes. */
export const HEADER=16;
/** The most bytes one answer carries; larger reads are asked for in pieces. */
export const CAPACITY=8*1024*1024;
export type FsOp=
 |{op:'stat';path:string}
 |{op:'readdir';path:string}
 |{op:'mkdir';path:string;recursive:boolean}
 |{op:'read';path:string;offset:number;length:number}
 |{op:'write';path:string;mode:'w'|'a'|'wx';data:Uint8Array}
 |{op:'unlink';path:string}
 |{op:'rm';path:string;recursive:boolean;force:boolean}
 |{op:'rename';from:string;to:string}
 |{op:'copy';from:string;to:string;exclusive:boolean}
 // Descriptors (node's open flags): reads and writes at a position, as programs that seek (ffmpeg, Python) make them.
 |{op:'open';path:string;flags:string}
 |{op:'pread';fd:number;position:number;length:number}
 |{op:'pwrite';fd:number;position:number|null;data:Uint8Array}
 |{op:'ftruncate';fd:number;length:number}
 |{op:'close';fd:number};
export type FsStat={kind:'file'|'directory';size:number;mtimeMs:number};
export type FsError={code:string;message:string;path?:string;syscall?:string};
