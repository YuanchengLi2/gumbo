import {z} from 'zod';
import {routeCodeRequest,type RequestIntent} from './routing';
import {works,type Work} from '@dream/config';

/** Triage: one small Haiku call reads a message with the recent conversation and says what it is (an edit, something to
 * answer, a plan, or carrying on with a stopped request), how hard it is from 1 to 5, whether doing it needs eyes on the
 * footage, whether it still wants a stopped request's asks, and its separate parts. The score picks the model tier (see
 * autoModel) and the thinking effort; the parts are what finishing must report on. Rules decide when Haiku cannot. */
export type TriageKind='edit'|'answer'|'plan'|'continue';
/** How a message reacts to the result before it: negative when it says that result is wrong, still broken or not what was
 * meant ("its still there", "no revert that"), positive when it approves or builds on it. */
export type Feedback='positive'|'negative'|'none';
export type Triage={kind:TriageKind;difficulty:number;vision:boolean;carriesStopped:boolean;parts:string[];reason:string;source:'model'|'rules';work?:Work;feedback?:Feedback;escalation?:number;model?:string};
export type TriageInput={message:string;mode:RequestIntent;recent:{role:string;text:string}[];stopped?:string;planWaiting?:boolean;models?:{id:string;name:string;bestAt:string;cost:string}[];previousModel?:string;project:{clips:number;overlays:number;audio:number;minutes:number;footageFiles:number};attachments:number};

export const triagePrompt=`You read one message a user sent to Figjam, a video editor where an AI agent makes every edit by writing code, and decide how it is handled. Reply with JSON only.

kind:
- "edit": they want the video or project made or changed. This includes short follow-ups that act on the conversation ("yeah go ahead", "do it", "go", "no revert that", "its still there" about something they asked to fix).
- "answer": they want something to read and nothing changed: a question, an opinion, a script, ideas or an outline to read, small talk, thanks, complaints, insults, anything off-topic. A question that needs a look at the video to answer ("why is the screen bright now") is still an answer.
- "plan": they ask for a plan before anything is built.
- "continue": a request was stopped (stopped is given) and this message only says to carry on with it ("continue", "keep going", "please continue", "continue work"); or a plan awaits approval (planAwaitingApproval) and this message accepts it or says to go ahead with it, in any words. Asking to change the plan is "plan".

difficulty, 1 to 5, for how much work and judgement doing it well takes:
1: one setting on one thing ("make the caption white", "mute the music", "delete the last clip"); small talk, thanks, a yes/no about the project.
2: a few precise changes; a question that needs a look at the video.
3: several changes that need judgement; writing a script; adding or restyling captions; retiming; finding and fixing a visual problem the user describes ("weird green tint at 10s").
4: new motion graphics or animation; music or sound design; choosing b-roll; re-editing a section; four or more separate asks.
5: a first cut or condensing long footage; restructuring the whole video; many new scenes from scratch.
Score what this message needs now, using the conversation to understand short follow-ups.

work: the kind of work: "talk" (small talk, thanks, complaints, questions about the app), "look" (a question that needs a look at the video), "write" (a script, ideas, an outline to read), "fix" (precise changes or fixes to what exists), "footage" (choosing, cutting or pacing shots, b-roll, finding footage), "graphics" (motion graphics, titles, animation, drawn elements), "sound" (music, sound effects, the mix, voice), "restructure" (a first cut, condensing long footage, reworking the whole video). Pick the main one.
feedback: how this message reacts to the previous result in the conversation: "negative" when it says that result is wrong, still broken, ugly or not what they meant, or asks to undo it ("its still there", "no revert that", "the b roll is ugly", "no you dont understand"); "positive" when it approves it or builds on it ("perfect", "nice, now add music"); "none" otherwise.
model: the id (from models) of the model that will do this request best. Match the work to what each model is best at; cost only decides between models equally good for it. Small talk and one setting on one thing need no strong model; choosing footage, reworking a video and writing that must be good do. When feedback is negative, choose a stronger model than previousResultBy.
vision: true when doing it well needs looking at the footage or the edit's frames.
carriesStopped: true when a request was stopped and this new message still wants what that request asked ("aside from that…", adds to it); false when it replaces or drops it, or nothing was stopped.
parts: every separate thing the message asks for, each one short instruction in the user's words (fix spelling only), including small asks mentioned in passing; one item for a single ask. When carriesStopped, also list the stopped request's asks.
reason: a short phrase.`;

/** The JSON schema the gateway enforces for purpose 'triage'. */
export const triageSchema={type:'object',properties:{kind:{type:'string',enum:['edit','answer','plan','continue']},difficulty:{type:'integer',minimum:1,maximum:5},work:{type:'string',enum:['talk','look','write','fix','footage','graphics','sound','restructure']},feedback:{type:'string',enum:['positive','negative','none']},model:{type:'string'},vision:{type:'boolean'},carriesStopped:{type:'boolean'},parts:{type:'array',items:{type:'string'}},reason:{type:'string'}},required:['kind','difficulty','work','feedback','model','vision','carriesStopped','parts','reason'],additionalProperties:false} as const;

export const triageMessage=(input:TriageInput)=>JSON.stringify({message:input.message.slice(0,6000),composerMode:input.mode==='plan'?'plan first':input.mode==='ask'?'answer only':'normal',
 ...(input.stopped?{stopped:input.stopped.slice(0,3000)}:{}),...(input.planWaiting?{planAwaitingApproval:true}:{}),
 recentConversation:input.recent.map(m=>({role:m.role,text:m.text.slice(0,m.role==='user'?800:600)})),project:input.project,attachedFiles:input.attachments,
 ...(input.models?.length?{models:input.models}:{}),...(input.previousModel?{previousResultBy:input.previousModel}:{})});

const Reply=z.object({kind:z.enum(['edit','answer','plan','continue']),difficulty:z.coerce.number(),work:z.string().optional().transform(w=>works.includes(w as Work)?w as Work:undefined),feedback:z.enum(['positive','negative','none']).catch('none').default('none'),model:z.string().optional().transform(m=>m?.trim()||undefined),vision:z.boolean().default(false),carriesStopped:z.boolean().default(false),parts:z.array(z.coerce.string()).default([]),reason:z.coerce.string().default('')});
/** Haiku's triage, or undefined when its reply is not one. */
export function parseTriage(text:string):Omit<Triage,'source'>|undefined{
 try{const json=JSON.parse(text.trim().replace(/^```(?:json)?\s*|\s*```$/g,''));const r=Reply.parse(json);
  return{...r,difficulty:Math.min(5,Math.max(1,Math.round(r.difficulty)||3)),parts:r.parts.map(p=>p.trim()).filter(Boolean).slice(0,20).map(p=>p.slice(0,300)),reason:r.reason.slice(0,200)};}
 catch{return undefined;}
}

// Work that needs real editing however it is phrased: new visuals, sound, captions, or anything across the whole video.
const bigWork=/\b(?:motion|graphics?|animat\w*|scenes?|intro|outro|title cards?|chapters?|lower thirds?|overlays?|3d|music|score|soundtrack|sound effects?|voice-?over|captions?|subtitles?|b-?roll|re-?edit|from scratch|whole|entire|every|throughout|restructure|story)\b/i;
const firstCut=/\b(?:first cut|condense|cut (?:it|this|them) (?:down|into)|(?:\d+|ten|five)[- ]minute|vlog|from (?:my|the) (?:footage|clips))\b/i;
// One setting on one thing: a short instruction that changes something that exists ("make the caption white").
const tweak=(text:string)=>text.length<70&&/^(?:(?:ok(?:ay)?|now|also|and|please|then|just)[,]?\s+)*(?:make|change|set|mute|unmute|move|delete|remove|trim|crop|rotate|flip|lower|raise|brighten|darken|warm|cool|speed up|slow down|shorten|lengthen)\b/i.test(text.trim())&&!/\b(?:new|more|every|all|whole)\b/i.test(text);
/** The rules' triage, when Haiku cannot answer: the old word rules for the kind, and a difficulty from the words. */
export function ruleTriage(input:TriageInput,interrupted=false):Triage{
 const route=routeCodeRequest(input.message,input.mode,interrupted),text=input.message;
 const kind:TriageKind=route.route==='continue'?'continue':route.route==='plan'?'plan':route.route==='question'?'answer':'edit';
 const asks=text.split(/\n+|\b(?:and then|also|after that|another thing)\b|[;]/i).filter(s=>s.trim().length>3).length;
 const difficulty=kind==='answer'?(text.length<160?1:2):firstCut.test(text)&&input.project.minutes>=3||input.project.clips===0&&bigWork.test(text)?5:tweak(text)&&input.project.clips>0?1:bigWork.test(text)||asks>=4||text.length>400?4:3;
 return{kind,difficulty,vision:kind!=='answer',carriesStopped:false,parts:[text.trim().slice(0,600)],reason:'word rules',source:'rules'};
}
/** The composer's mode is the user's explicit choice and wins over the triage: plan first, or answer only. Carrying on only
 * means something while a stopped request exists. */
export function withMode(triage:Triage,intent:RequestIntent,interrupted:boolean):Triage{
 const kind:TriageKind=intent==='plan'?'plan':intent==='ask'?'answer':triage.kind==='continue'&&!interrupted?'edit':triage.kind;
 return{...triage,kind,carriesStopped:interrupted&&kind!=='continue'&&triage.carriesStopped};
}
/** The route record the rest of the engine reads (routing:<turn>): route, complexity and reason, plus the score. */
export const routeRecord=(t:Triage)=>({route:t.kind==='edit'?'local':t.kind==='answer'?'question':t.kind,intelligence:'haiku' as const,complexity:t.difficulty<=1?'simple':t.difficulty>=4?'difficult':'normal',difficulty:t.difficulty,vision:t.vision,carriesStopped:t.carriesStopped,reason:t.reason||'Scored by triage.',source:t.source,requestedChanges:[] as string[]});
