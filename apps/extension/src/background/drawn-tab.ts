import {on} from './surfaces';
import {model} from './model';
import {viewPicture} from './predict';
import {fieldMemory,fieldReady} from './memory-context';
import {lately} from './lately';
import {loadSettings,activeOn,siteOf} from '../shared/settings';
import {DRAWN_TAB_SYSTEM} from '../shared/prompts';
import {textOf} from '../shared/gateway';
import {cleanSuggestion,lastWordOf} from '../shared/suggestion';
import {thrifty} from './thrift';
/** Tab for text in a drawn editor (Google Docs, Slides, a design tool's text): their words are only in the drawing, so
 * the model reads a picture of their view with the caret drawn in red, with what memory holds about the page and what
 * they just copied, and its words show beside the caret (drawn by the page: the typing box may be in a frame one pixel
 * tall). */
on('tab.drawn',async(m:{id:string;caret:[number,number,number];typed?:string;view:[number,number];title:string},{send,signal,url,port})=>{
 const answer=(text:string)=>{if(!signal.aborted)send({type:'tab.drawn',id:m.id,text});};
 const tab=port.sender?.tab,page=tab?.url??url,settings=await loadSettings();
 if(!tab||tab.incognito||!activeOn(settings,siteOf(page))){answer('');return;}
 // Saving credits (thrift.ts): only a longer pause is asked about (a key typed meanwhile cancels this).
 if(await thrifty()){await new Promise(r=>setTimeout(r,800));if(signal.aborted)return;}
 const key=`drawn|${siteOf(page)}|${m.title}`,had=fieldMemory(key,m.title,page,3);
 const [shot,memory,copied]=await Promise.all([viewPicture(tab,m.view,true,m.caret),had.length?had:fieldReady(key,150),lately(page).then(l=>l.copied.filter(c=>Date.now()-c.at<5*60_000)).catch(()=>[])]);
 if(!shot||signal.aborted){answer('');return;}
 const typed=m.typed??'',word=lastWordOf(typed);
 const context=[
  `<document>\n“${m.title}” (${siteOf(page)}), drawn as pixels: the picture is their view, and the red line in it is their cursor.\n</document>`,
  memory.length?`<from_their_memory>\n${memory.map(r=>`${r.title} (${r.when}): ${r.text.slice(0,400)}`).join('\n')}\n</from_their_memory>`:'',
  copied.length?`<they_just_copied>\n${copied.at(-1)!.text.slice(0,500)}\n</they_just_copied>`:'',
  // What they just typed (it ends at the red line) lets the words meet theirs exactly, as Tab does in any field.
  typed?`They just typed “${typed.slice(-200)}”, which ends at the red line. ${word?`Begin with "${word}", the word the cursor is in or right after.`:'The cursor follows a space or a new line: begin with the next word.'}`:'',
  'What do they type next, at the red line?',
 ].filter(Boolean).join('\n');
 try{
  const {message}=await model({model:settings.models.tab,system:DRAWN_TAB_SYSTEM,messages:[{role:'user',content:[{type:'image',source:{type:'base64',media_type:'image/jpeg',data:shot.data}},{type:'text',text:context}]}],max_tokens:40,purpose:'tab',stream:false},{signal});
  // The same checks as any Tab suggestion but the facts guard: the facts are in the picture, where code cannot look,
  // so the prompt holds the model to them. With nothing typed yet, the model's own leading space says where it starts.
  const raw=textOf(message),checks={after:'',singleLine:false,known:raw,final:true};
  answer(typed?cleanSuggestion(raw,{...checks,before:typed,lastWord:word||undefined}):(raw.startsWith(' ')?' ':'')+cleanSuggestion(raw,{...checks,before:''}));
 }catch{answer('');}
});
/** The words show, and go, in the page itself (its top frame), whichever frame the typing box is in. */
const toPage=(tab:number|undefined,message:Record<string,unknown>)=>tab===undefined?undefined:chrome.tabs.sendMessage(tab,message,{frameId:0}).catch(()=>{});
on('tab.drawnShow',async(m:{text:string;caret:[number,number,number]},{port})=>{await toPage(port.sender?.tab?.id,{type:'drawn.show',text:m.text,caret:m.caret});});
on('tab.drawnHide',async(_m:unknown,{port})=>{await toPage(port.sender?.tab?.id,{type:'drawn.hide'});});
