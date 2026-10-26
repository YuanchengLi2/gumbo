import {getMedia,add} from './db';
import {model} from './model';
import {loadSettings} from '../shared/settings';
import {NOTES_SYSTEM} from '../shared/prompts';
import {clock} from '../shared/moment';
/** Notes for what was heard, when it ends: a summary, decisions, to-dos with owners, key points with their moments.
 * A meeting gets them once a minute of it was said; a video or talk once it ran for a few minutes. They are kept with
 * it, so Tab and Ctrl+K use them (the follow-up email), and the side panel shows them. */
export async function writeNotes(id:string):Promise<string|undefined>{
 const media=await getMedia(id);if(!media||media.notes)return media?.notes;
 const words=media.segments.reduce((n,s)=>n+s.text.split(/\s+/).length,0),span=(media.segments.at(-1)?.end??0)-(media.segments[0]?.start??0);
 if(words<60||media.kind!=='meeting'&&span<150)return;
 let transcript=media.segments.map(s=>`[${clock(s.start)}] ${s.speaker?`${s.speaker}: `:''}${s.text}`).join('\n');
 // A very long one keeps its start and its end (where decisions and to-dos usually are).
 if(transcript.length>120_000)transcript=`${transcript.slice(0,80_000)}\n[…]\n${transcript.slice(-40_000)}`;
 const settings=await loadSettings();
 const {message}=await model({model:settings.models.notes,system:NOTES_SYSTEM,messages:[{role:'user',content:`${media.kind==='meeting'?'Meeting':media.kind==='video'?'Video':'Audio'}: ${media.title}\n\n${transcript}`}],max_tokens:1200,purpose:'action',stream:false});
 const notes=(message?.content??[]).map((b:any)=>b.text??'').join('').trim();
 if(!notes)return;
 const latest=await getMedia(id)??media;latest.notes=notes;await add('media',latest);
 return notes;
}
