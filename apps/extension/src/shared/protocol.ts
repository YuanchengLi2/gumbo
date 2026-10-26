/** Messages between the pages, the popup and the service worker. One-shot requests go through
 * chrome.runtime.sendMessage; streams (Tab, Ctrl+K) through a port each frame opens. */
export type Request=
 |{type:'auth.state'}
 |{type:'auth.signin'}
 |{type:'auth.signout'}
 |{type:'auth.code';code?:string;error?:string}
 |{type:'stats'}
 |{type:'spend'}
 |{type:'memory.counts'}
 |{type:'memory.forget';site?:string;since?:number}
 |{type:'meter.run';count?:number}
 |{type:'meter.actions'}
 |{type:'import.run'}
 |{type:'import.state'};

export type AuthState={signedIn:boolean;email?:string};
export type Stats={tab:{p50?:number;p90?:number;samples:number};shown:number;accepted:number;dismissed:number;failures:number;byWhat:Record<string,number>};

export function ask<T=any>(message:Request):Promise<T>{return chrome.runtime.sendMessage(message);}
