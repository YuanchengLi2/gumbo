import type {FileProposal} from '@dream/contracts';

const basename=(path:string)=>String(path??'file').split(/[\\/]/).filter(Boolean).at(-1)??path;

/** The row the chat shows for a tool call: the model's own progress label when it gave one, otherwise a plain default. */
export function toolActivity(name:string|undefined,input:any):string|undefined{
 input=input&&typeof input==='object'?input:{};
 if(typeof input.progress==='string'&&input.progress.trim())return input.progress.trim();
 switch(name){
  case 'read':return 'Reading '+basename(input.path??'a file');
  case 'grep':return input.pattern?`Searching for “${String(input.pattern).slice(0,60)}”`:'Searching';
  case 'list':return 'Checking files';
  case 'write':return input.path==='project.json'?'Updating the edit':'Writing '+basename(input.path??'a file');
  case 'edit':return input.path==='project.json'?'Updating the edit':'Editing '+basename(input.path??'a file');
  case 'run':return /\b(?:npm (?:install|ci)|pip install)\b/.test(String(input.command??''))?'Preparing tools':'Working on the edit';
  case 'look':return input.target==='edit'?'Looking at the edit':'Looking at the footage';
  case 'listen':return input.target==='edit'?'Listening to the edit':'Listening to the sound';
  case 'review':return 'Watching the edit';
  case 'track':return typeof input.subject==='string'&&input.subject.trim()?`Following ${input.subject.trim().slice(0,60)}`:'Following the subject';
  case 'find':return input.query?`Searching your footage for “${String(input.query).slice(0,60)}”`:'Going through your footage';
  case 'task':return typeof input.title==='string'&&input.title.trim()?input.title.trim():'Looking into it';
  case 'todo':return 'Updating tasks';
  case 'media':return input.action==='import'?'Importing media':input.online?`Searching free ${input.online} libraries`:'Finding media on your computer';
  case 'web':return input.url?'Reading a web page':'Searching the web';
  case 'propose_plan':return 'Writing the plan';
  case 'propose_files':return typeof input.title==='string'&&input.title.trim()?input.title.trim():'Preparing file changes';
  default:return undefined;
 }
}
/** A short detail under the row: the command, the file, or the search. Never anything secret. */
export function toolDetail(name:string|undefined,input:any,_partial=''):string|undefined{
 if(name==='run')return String(input?.command??'').slice(0,4000)||undefined;
 if(['read','write','edit'].includes(name??''))return input?.path;
 if(name==='look'||name==='listen')return input?.source??input?.path;
 if(name==='web')return String(input?.query??input?.url??'').slice(0,200)||undefined;
 if(name==='grep')return input?.path;
 return undefined;
}
/** What approved file changes did, for the request's change list. */
export function fileChanges(proposal:FileProposal):string[]{return proposal.changes.slice(0,proposal.completed).map(({operation:op,exists})=>{
 if(op.kind==='write')return `${exists?'Updated':'Created'} ${basename(op.path)}`;
 if(op.kind==='mkdir')return `Created folder ${op.path}`;
 if(op.kind==='copy')return `Copied ${basename(op.path)} to ${op.destination}`;
 if(op.kind==='move')return `Moved ${basename(op.path)} to ${op.destination}`;
 if(op.kind==='trash')return `Moved ${basename(op.path)} to Trash`;
 return `Exported video to ${op.path}`;
});}
