import type {FileProposal} from '@dream/contracts';
const basename=(path:string)=>String(path??'file').split(/[\\/]/).filter(Boolean).at(-1)??path;
export function toolActivity(name:string|undefined,input:any):string|undefined{
 input=input&&typeof input==='object'?input:{};
 if(typeof input.progress==='string'&&input.progress.trim())return input.progress.trim();
 const command=String(input.command??'');
 if(name==='delegate'&&Array.isArray(input.tasks))return input.tasks.length===1?String(input.tasks[0]?.title??'Assigning the edit'):`Working on ${input.tasks.length} parts in parallel`;
 const generic:Record<string,string>={remember_decision:'Remembering your editing preference',consult_director:'Refining the creative direction',set_project_title:'Naming project',list_files:'Checking project materials',search:'Searching project context',read_file:'Reviewing the edit',write_file:'Creating the edit',edit_file:'Refining the edit',run_command:/\b(?:npm (?:install|ci|rebuild)|pip install)\b/.test(command)?'Preparing editing tools':'Preparing the edit',bundle_scene:'Preparing the scene',check_outputs:'Previewing the scene',import_resources:'Bringing in files',read_transcript:'Reading the transcript',publish_project:'Updating the preview',view_media:'Inspecting media',update_tasks:'Updating tasks',propose_file_changes:typeof input.title==='string'&&input.title.trim()?input.title.trim():'Preparing file changes',finish:'Completing the request'};
 if(name&&generic[name])return generic[name];
 if(name==='computer_files'){
  if(input.action==='read')return `Reading ${basename(input.path)}`;
  if(input.action==='list')return input.path?`Browsing ${basename(input.path)}`:'Checking available folders';
  if(input.action==='search')return `Finding files matching “${input.query}”`;
  if(input.action==='propose')return input.title||'Preparing file changes';
  return undefined;
 }
 const labels:Record<string,string>={get_project:'Reading the current edit',search_project:'Finding relevant project material',read_project_chunk:'Reading project context',inspect_footage:'Inspecting your footage',read_footage:'Reading footage details',search_footage:'Finding the right moments',list_assets:'Checking project media',import_computer_media:'Importing selected media',generate_music:'Creating music',create_score:'Composing music',edit_score:'Updating the music',generate_sfx:'Creating sound effects',create_sfx:'Creating a sound effect',write_visual_module:'Building the animation',patch_visual_module:'Updating the animation',set_visual_parameters:'Adjusting the animation',read_visual_module:'Reading the saved animation',list_sound_catalog:'Finding music and sound effects'};
 return name?labels[name]:undefined;
}
/** Bounded public action details. Provider signatures are never included. */
export function toolDetail(name:string|undefined,input:any,partial=''):string|undefined{
 if(name==='run_command')return String(input?.command??'').slice(0,4000);
 if(['read_file','write_file','edit_file'].includes(name??''))return input?.path;
 if(name==='view_media')return input?.path??input?.assetId;
 if(name==='delegate'&&Array.isArray(input?.tasks))return input.tasks.map((t:any)=>t?.title).filter(Boolean).join('\n').slice(0,2000)||undefined;
 return undefined;
}
export function fileChanges(proposal:FileProposal):string[]{return proposal.changes.slice(0,proposal.completed).map(({operation:op,exists})=>{
 if(op.kind==='write')return `${exists?'Updated':'Created'} ${basename(op.path)}`;
 if(op.kind==='mkdir')return `Created folder ${op.path}`;
 if(op.kind==='copy')return `Copied ${basename(op.path)} to ${op.destination}`;
 if(op.kind==='move')return `Moved ${basename(op.path)} to ${op.destination}`;
 if(op.kind==='trash')return `Moved ${basename(op.path)} to Trash`;
 return `Exported video to ${op.path}`;
});}
