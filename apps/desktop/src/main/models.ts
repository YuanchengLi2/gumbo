import {app} from 'electron';import {mkdirSync,existsSync,createWriteStream,createReadStream,renameSync,unlinkSync,statSync,readFileSync} from 'node:fs';import {join} from 'node:path';import {createHash} from 'node:crypto';import {Readable} from 'node:stream';import {pipeline} from 'node:stream/promises';
import {downloadVerified,fileHash,type Download} from './download';
export class Models {
 readonly folder=join(app.getPath('userData'),'models');private controllers=new Map<string,AbortController>();
 constructor(private publish:(event:string,payload:unknown)=>void){mkdirSync(this.folder,{recursive:true});}
 manifest(){return JSON.parse(readFileSync(app.isPackaged?join(process.resourcesPath,'models-manifest.json'):join(app.getAppPath(),'resources/models-manifest.json'),'utf8'));}
 async install(id:string){const entry:Download|undefined=this.manifest().models.find((m:Download)=>m.id===id);if(!entry)throw new Error('Unknown model.');if(this.controllers.has(id))throw new Error('The model download is already running.');const controller=new AbortController();this.controllers.set(id,controller);try{const path=await downloadVerified(entry,join(this.folder,entry.filename),controller.signal,(status,bytes)=>this.publish('models.progress',{id,status,bytes,total:entry.bytes,progress:bytes/entry.bytes}));return{path};}finally{this.controllers.delete(id);}}

 cancel(id:string){this.controllers.get(id)?.abort();}
 async hash(path:string){const hash=createHash('sha256');for await(const chunk of createReadStream(path))hash.update(chunk);return hash.digest('hex');}
 whisperModel(){const entry=this.manifest().models[0];const path=join(this.folder,entry.filename);return existsSync(path)?path:'';}
}
