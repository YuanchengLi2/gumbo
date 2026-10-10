import type {ProjectDB} from '@dream/project-db';
import type {PublicActivity} from '@dream/contracts';
import {toolActivity,toolDetail} from './activity';

/** Provider blocks and actual executions share stable activity IDs. No synthetic thought text. */
export class RunStream {
 private blocks=new Map<number,{type:string;id:string;name?:string;text:string;json:string}>();
 private updates=false;private last=0;private emitted=new Map<string,string>();
 constructor(private db:ProjectDB,private turnId:string,private requestId:string,private publish?:(type:string,payload:unknown)=>void,private showProse=true){}
 // Each write re-serializes the turn's activity log and crosses IPC; identical drafting updates (long tool inputs) are skipped.
 emit(patch:Omit<PublicActivity,'sequence'>){const signature=JSON.stringify(patch);if(this.emitted.get(patch.id)===signature)return;this.emitted.set(patch.id,signature);const event=this.db.activityEvent(this.turnId,{...patch,requestId:this.requestId});if(event)this.publish?.('ai.activity',{turnId:this.turnId,event});}
 accept({event,data}:{event:string;data:any}){
  if(event==='dream_policy'){this.updates=data.thinkingDisplay==='updates';return;}
  if(data.type==='content_block_start'){
   const b=data.content_block;this.blocks.set(data.index,{type:b.type,id:b.id??`${this.requestId}:${b.type}:${data.index}`,name:b.name,text:b.text??b.thinking??'',json:''});this.flush(data.index);return;
  }
  if(data.type==='content_block_delta'){
   const b=this.blocks.get(data.index);if(!b)return;
   if(data.delta.type==='text_delta')b.text+=data.delta.text;
   if(data.delta.type==='thinking_delta'&&this.updates)b.text+=data.delta.thinking;
   if(data.delta.type==='input_json_delta')b.json+=data.delta.partial_json;
   if(Date.now()-this.last>150){this.last=Date.now();this.flush(data.index);}return;
  }
  if(data.type==='content_block_stop')this.flush(data.index,true);
 }
 private flush(index:number,done=false){
  const b=this.blocks.get(index);if(!b)return;
  if(this.showProse&&b.type==='text'&&b.text)this.emit({id:b.id,kind:'commentary',text:b.text,status:done?'complete':'streaming'});
  if(b.type==='tool_use'){
   let input:any={};try{input=JSON.parse(b.json);}catch{}
   this.emit({id:'tool:'+b.id,kind:'action',text:toolActivity(b.name,input)??'Preparing '+(b.name??'an action').replaceAll('_',' '),tool:b.name,detail:toolDetail(b.name,input,b.json),status:done?'ready':'drafting'});
  }
 }
 finish(body:any){
  if(!this.showProse)return;
  const updates=body.dream_policy?.thinkingDisplay==='updates',terminal=body.content?.some((b:any)=>b.type==='tool_use'&&b.name==='finish')||body.stop_reason==='end_turn'&&!body.content?.some((b:any)=>b.type==='tool_use');
  body.content?.forEach((block:any,index:number)=>{
   if(block.type==='text'&&block.text)this.emit({id:`${this.requestId}:text:${index}`,kind:terminal?'terminal':'commentary',text:block.text,status:'complete'});
  });
 }
 interrupt(reason:string){for(const b of this.blocks.values())if(b.type==='tool_use')this.emit({id:'tool:'+b.id,kind:'action',text:toolActivity(b.name,{})??'Preparing an action',tool:b.name,status:'interrupted',detail:reason});}
}
