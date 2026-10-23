import type {ProcessResult,RunRequest,RunningProcess,SandboxAssets} from './sandbox';

/** What the page may set for the worker's sandbox: everything serializable in SandboxOptions. */
export interface WorkerOptions{workspace?:string;env?:Record<string,string>;maxOutputChars?:number;memoryLimitBytes?:number;logDir?:string;maxLogBytes?:number;waitMs?:number;assets?:SandboxAssets}
export type FsOp={op:'read';path:string}|{op:'write';path:string;data:Uint8Array|string}|{op:'list';path:string}|{op:'stat';path:string}|{op:'mkdir';path:string}|{op:'remove';path:string};
/** Page → worker. Each carries an id the reply echoes. */
export type Request=
 |{type:'init';options:WorkerOptions;interrupt?:Int32Array}
 |{type:'start';request:RunRequest}
 |{type:'wait';processId:string;waitMs:number}
 |{type:'stop';processId:string;reason?:string;timeout?:boolean}
 |{type:'list'}
 |{type:'fs';fs:FsOp};
/** Worker → page: replies, output as it comes, and each process's result when it ends. */
export type Event=
 |{type:'reply';id:number;ok:true;value:unknown}
 |{type:'reply';id:number;ok:false;error:string}
 |{type:'output';processId:string;text:string}
 |{type:'done';processId:string;result:ProcessResult};
export interface InitResult{commands:string[];threads:boolean;crossOriginIsolated:boolean}
export type {ProcessResult,RunRequest,RunningProcess};
