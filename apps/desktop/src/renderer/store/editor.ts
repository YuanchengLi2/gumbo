import type {PublicActivity} from '@dream/contracts';
import {usePlayhead} from './playhead';
import {applyDocumentDelta,type DocumentChange} from '../../../../../packages/timeline/src/document-delta';
import {create} from 'zustand';
import type {ProjectState} from '@dream/project-db';
export type LiveCommentary={turnId:string;requestId:string;text:string;status:'streaming'|'complete'|'discarded'};
/** A sent message shown at once, until the saved conversation includes it. */
export type PendingMessage={selection?:import('@dream/timeline').SelectionRef[];requestId:string;text:string;assetIds:string[];createdAt:string};
/** Cost and time of the running request, per caller (main for the editing agent, or a helper's activity id) and model. */
export type UsageRow={owner:string;model:string;calls:number;cost:number;prompt:number;output:number;ms:number};
export type TurnUsage={turnId:string;rows:UsageRow[]};
/** Gumbo's layout is the chat beside the player and timeline; the editor's is OpenCut's (assets, preview and properties
 * over a full-width timeline). Both show the same project, timeline and undo history. */
export type Layout='gumbo'|'editor';
/** The panel on the left: chat, media and elements in both layouts, and the editor's libraries in the editor layout. */
export type SidebarTab='chat'|'media'|'elements'|'text'|'stickers'|'effects'|'transitions'|'filters'|'captions';
export type Permission='auto'|'plan'|'ask';export type Effort='auto'|'low'|'medium'|'high';export type ModelChoice=import('@dream/config').ModelChoice;
// Composer choices are a per-viewer convenience; storage can be unavailable.
const stored=<T extends string>(key:string,allowed:readonly T[],fallback:T):T=>{try{const value=localStorage.getItem(key) as T;return allowed.includes(value)?value:fallback;}catch{return fallback;}};
const remember=(key:string,value:string)=>{try{localStorage.setItem(key,value);}catch{}};
const delivered=(project:ProjectState,pending:PendingMessage)=>project.messages.some(m=>m.role==='user'&&m.text.trim()===pending.text&&m.createdAt>=new Date(Date.parse(pending.createdAt)-60000).toISOString());
type State={usage:TurnUsage|null;setUsage:(value:TurnUsage|null)=>void;returned:string|null;pending:PendingMessage|null;setPending:(value:PendingMessage|null)=>void;permission:Permission;setPermission:(value:Permission)=>void;effort:Effort;setEffort:(value:Effort)=>void;model:ModelChoice;setModel:(value:ModelChoice)=>void;draft:import('@dream/contracts').WorkspaceDraft|null;setDraft:(value:import('@dream/contracts').WorkspaceDraft|null)=>void;commentary:LiveCommentary[];setCommentary:(value:LiveCommentary)=>void;project:ProjectState|null;route:'home'|'ai'|'manual';sidebarTab:SidebarTab;layout:Layout;setLayout:(value:Layout)=>void;snapping:boolean;setSnapping:(value:boolean)=>void;selected:string[];attachments:string[];frame:number;playing:boolean;zoom:number;error:string|null;busy:boolean;setProject:(p:ProjectState)=>void;setRoute:(route:State['route'])=>void;setSidebarTab:(tab:State['sidebarTab'])=>void;setAttachments:(ids:string[])=>void;setSelected:(ids:string[])=>void;setFrame:(n:number)=>void;setPlaying:(v:boolean)=>void;setZoom:(n:number)=>void;setError:(error:string|null)=>void;setBusy:(v:boolean)=>void};
/** Stop shows at once: the request is marked stopped here while the service unwinds it (a model call or a command in
 * flight finishes first), and updates still saying it runs are read as stopped until the service confirms. */
let stoppedTurn:string|undefined;
export function stopRun(){const project=useEditor.getState().project;if(!project)return;stoppedTurn=project.experience?.turnId;useEditor.getState().setProject({...project,aiStatus:'interrupted'});void window.dream.command({type:'cancel'}).catch(()=>{});}
/** The service said the request ended (or a new one began): updates are read as they come again. */
export function stopConfirmed(){stoppedTurn=undefined;}
export const useEditor=create<State>((set,get)=>({usage:null,setUsage:usage=>set({usage}),returned:null,pending:null,setPending:pending=>set({pending}),permission:stored('dream-permission',['auto','plan','ask'] as const,'auto'),setPermission:permission=>{remember('dream-permission',permission);set({permission});},effort:stored('dream-effort',['auto','low','medium','high'] as const,'auto'),setEffort:effort=>{remember('dream-effort',effort);set({effort});},model:stored('dream-model-choice',['auto','sonnet','opus','gpt-astra','gpt-sol','gemini-argon','gemini-flash'] as const,'auto'),setModel:model=>{remember('dream-model-choice',model);set({model});},draft:null,setDraft:draft=>set({draft}),commentary:[],setCommentary:value=>set(state=>{const p=state.project,commentary=value.status==='discarded'?state.commentary.filter(c=>c.requestId!==value.requestId):[...state.commentary.filter(c=>c.requestId!==value.requestId&&c.turnId===value.turnId),value];if(p?.experience?.turnId!==value.turnId)return{commentary};const activity={steps:[],status:p.aiStatus,changes:[],...p.experience.activity},events=[...(activity.events??[])],found=events.find(e=>e.id===value.requestId);if(found){found.text=value.text;found.status=value.status;}else events.push({id:value.requestId,requestId:value.requestId,sequence:events.length,kind:'commentary',text:value.text,status:value.status});return{commentary,project:{...p,experience:{...p.experience,activity:{...activity,events}}}};}),project:null,route:'home',sidebarTab:'chat',layout:stored('dream-layout',['gumbo','editor'] as const,'gumbo'),setLayout:layout=>{remember('dream-layout',layout);set({layout});},snapping:stored('dream-snapping',['on','off'] as const,'on')==='on',setSnapping:snapping=>{remember('dream-snapping',snapping?'on':'off');set({snapping});},selected:[],attachments:[],frame:0,playing:false,zoom:1,error:null,busy:false,
 setProject:project=>{if(stoppedTurn&&project.aiStatus==='running'&&project.experience?.turnId===stoppedTurn)project={...project,aiStatus:'interrupted'};const current=get().project;if(current?.meta.id===project.meta.id&&current.stateSequence!==undefined&&project.stateSequence!==undefined&&project.stateSequence<current.stateSequence)return;const changed=get().project?.meta.id!==project.meta.id;if(!changed&&current)project=mergeActivitySnapshots(current,project);const pending=get().pending;set({project,...(pending&&(changed||delivered(project,pending))?{pending:null}:{}),...(changed?{commentary:[],selected:[],attachments:[],frame:0,playing:false,route:'ai' as const}:{})});},
 setRoute:route=>{if(route!=='home')localStorage.setItem('dream-editor-mode','assistant');set({route:route==='manual'?'ai':route,playing:false});},setSidebarTab:sidebarTab=>set({sidebarTab}),setAttachments:attachments=>set({attachments}),setSelected:selected=>set({selected}),setFrame:frame=>{usePlayhead.setState({frame});if(!get().playing)set({frame});},setPlaying:playing=>set(playing?{playing}:{playing,frame:usePlayhead.getState().frame}),setZoom:zoom=>set({zoom}),setError:error=>set({error}),setBusy:busy=>set({busy})}));
export function mergeProjectDelta(update:{projectId:string;baseSequence?:number;sequence?:number;baseCursor:number;cursor:number;changes:Partial<ProjectState>&{timelineDelta?:DocumentChange[]}}){
 const store=useEditor.getState(),current=store.project;if(!current||current.meta.id!==update.projectId||(update.baseSequence!==undefined?current.stateSequence!==update.baseSequence:current.eventCursor!==update.baseCursor))return false;
 const changes={...update.changes};if(changes.timelineDelta){changes.timeline=applyDocumentDelta(current.timeline,changes.timelineDelta);delete changes.timelineDelta;}
 for(const key of ['messages','versions'] as const)if(changes[key]){const byId=new Map<string,any>(current[key].map(m=>[m.id,m]));changes[key]!.forEach(m=>byId.set(m.id,m));(changes as any)[key]=[...byId.values()].sort((a,b)=>key==='messages'?a.createdAt.localeCompare(b.createdAt):b.createdAt.localeCompare(a.createdAt));}
 store.setProject({...current,...changes,eventCursor:update.cursor,stateSequence:update.sequence??current.stateSequence});return true;
}

export function mergeRunEvents(previous:PublicActivity[]=[],incoming:PublicActivity[]=[]){const byId=new Map(previous.map(e=>[e.id,e]));for(const event of incoming){const old=byId.get(event.id);if(!old||(event.revision??0)>=(old.revision??0))byId.set(event.id,event);}return[...byId.values()].sort((a,b)=>a.sequence-b.sequence);}
function mergeActivitySnapshots(previous:ProjectState,incoming:ProjectState):ProjectState{
 const old=previous.experience,current=incoming.experience;
 if(old?.turnId===current?.turnId&&old?.activity&&current?.activity&&old.activity.events!==current.activity.events)incoming={...incoming,experience:{...current,activity:{...current.activity,events:mergeRunEvents(old.activity.events,current.activity.events)}}};
 // Messages that did not change keep their objects, so the chat's finished turns are not drawn again for every update.
 if(incoming.messages===previous.messages)return incoming;
 const prior=new Map(previous.messages.map(m=>[m.id,m]));return{...incoming,messages:incoming.messages.map(m=>{const before=prior.get(m.id);return m===before||!m.activity||!before?.activity?m:{...m,activity:{...m.activity,events:mergeRunEvents(before.activity.events,m.activity.events)}};})};
}
export function acceptRunActivity(turnId:string,event:PublicActivity){const store=useEditor.getState(),project=store.project;if(!project||project.experience?.turnId!==turnId)return;const activity=project.experience.activity??{steps:[],status:project.aiStatus,changes:[]};store.setProject({...project,experience:{...project.experience,activity:{...activity,events:mergeRunEvents(activity.events,[event])}}});}

/** The running request's phase (planning, answering or editing), as soon as the agent sets it. A phase for a newer
 * request than the one on screen starts that request's activity. */
export function acceptRunPhase(turnId:string,phase:'answering'|'planning'|'editing'){const store=useEditor.getState(),project=store.project;if(!project)return;const same=project.experience?.turnId===turnId,activity=same&&project.experience?.activity?project.experience.activity:{steps:[],status:'running',changes:[]};store.setProject({...project,experience:{...(project.experience??{firstDraftVersionId:null,steps:[]}),turnId,activity:{...activity,phase}}});}

/** Adds one model call (an ai.usage event) to the running request's totals. */
export function acceptUsage(event:{turnId?:string;model:string;parent?:string;costUsd?:number;durationMs?:number;usage?:any}){
 if(!event.turnId)return;const store=useEditor.getState(),u=event.usage??{},owner=event.parent??'main';
 const rows=store.usage?.turnId===event.turnId?[...store.usage.rows]:[],index=rows.findIndex(r=>r.owner===owner&&r.model===event.model),old=rows[index]??{owner,model:event.model,calls:0,cost:0,prompt:0,output:0,ms:0};
 const row={...old,calls:old.calls+1,cost:old.cost+(event.costUsd??0),prompt:old.prompt+(u.input_tokens??0)+(u.cache_read_input_tokens??0)+(u.cache_creation_input_tokens??0),output:old.output+(u.output_tokens??0),ms:old.ms+(event.durationMs??0)};
 if(index<0)rows.push(row);else rows[index]=row;store.setUsage({turnId:event.turnId,rows});
}
