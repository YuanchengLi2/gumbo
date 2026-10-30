import {it,expect,describe} from 'vitest';
import {cleanSuggestion,remainder,join,dropEcho,trimOverlap,factsGuard,firstSentence,wholeWords,alternativesOf} from '../../../apps/extension/src/shared/suggestion';

const input=(before:string,o:Partial<{after:string;singleLine:boolean;known:string;final:boolean}>={})=>({before,after:o.after??'',singleLine:o.singleLine??false,known:o.known??'',final:o.final??true});

describe('Tab suggestion checks',()=>{
 it('strips preambles, quotes and echoes of what was typed',()=>{
  expect(cleanSuggestion('Sure: the notes from today.',input('Thanks for'))).toBe(' the notes from today.');
  expect(cleanSuggestion('"see you then."',input('Great,'))).toBe(' see you then.');
  expect(cleanSuggestion('thanks for the update.',input('Hi Sam, thanks for'))).toBe(' the update.');
  expect(dropEcho('I will',' will send it today')).toBe(' send it today');
 });
 it('joins cleanly: one space, a half word finished',()=>{
  expect(join('Thanks for ',' the notes')).toBe('the notes');
  expect(join('Thanks,','see you')).toBe(' see you');
  expect(cleanSuggestion('nks for the help.',input('Tha'))).toBe('nks for the help.');
  expect(join('','  Hello')).toBe('Hello');
 });
 it('goes up to two whole sentences, leaves an unfinished one out, and never puts a newline in a one-line field',()=>{
  expect(firstSentence(' see you then. Also, bring the',{singleLine:false,before:'Great,'})).toBe(' see you then.');
  expect(firstSentence(' see you then. Bring the slides. I will book the room. Lunch after?',{singleLine:false,before:'Great,'})).toBe(' see you then. Bring the slides.');
  expect(firstSentence(' go through it this afternoon',{singleLine:false,before:'I will'})).toBe(' go through it this afternoon');
  expect(firstSentence(' flights to Tokyo. And hotels.',{singleLine:true,before:'cheap'})).toBe(' flights to Tokyo.');
  expect(cleanSuggestion(' flights to Tokyo\nand hotels',input('cheap',{singleLine:true,known:'Tokyo'}))).toBe(' flights to Tokyo');
  // A sign-off with their name is one thing to take.
  expect(cleanSuggestion('\n\nBest,\nSam',input('Talk soon.',{known:'Sam'}))).toBe('\n\nBest,\nSam');
  // A blank line ends the suggestion.
  expect(firstSentence('Sounds good.\n\nAlso',{singleLine:false,before:'Hi Sam,\n'})).toBe('Sounds good.');
 });
 it('splits the reply into the best continuation and its alternatives',()=>{
  expect(alternativesOf(' go through it tonight.\n⟂\n take a look tomorrow.\n⟂\n share it')).toEqual([' go through it tonight.',' take a look tomorrow.',' share it']);
  expect(alternativesOf(' only one')).toEqual([' only one']);
 });
 it('does not write what already follows the cursor',()=>{
  expect(trimOverlap(' see you tomorrow',' tomorrow.')).toBe(' see you');
  expect(cleanSuggestion(' meet at noon tomorrow.',input('Can we',{after:' tomorrow?'}))).toBe(' meet at noon');
 });
 it('cuts before facts the user has not seen or written',()=>{
  // Cut where a sentence could pause: never on a word waiting for what was cut ("at").
  expect(factsGuard(' call me at 555-0199 tomorrow','')).toBe(' call me');
  expect(factsGuard(' the invoice for $1,200 is attached','the invoice for $1,200')).toBe(' the invoice for $1,200 is attached');
  expect(cleanSuggestion(' Sarah and I will be there.',input('Thanks to',{known:''}))).toBe('');
  expect(cleanSuggestion(' Sarah and I will be there.',input('Thanks to',{known:'From: Sarah Lee'}))).toBe(' Sarah and I will be there.');
  expect(cleanSuggestion(' see you on Friday.',input('Great,'))).toBe(' see you');
 });
 it('drops a suggestion in another script, or one that repeats the text',()=>{
  expect(cleanSuggestion(' see you soon.',input('明日の会議ですが、'))).toBe('');
  expect(cleanSuggestion(' thanks for the quick reply on this',input('Hi, thanks for the quick reply on this. Hi,'))).toBe('');
 });
 it('shows only whole words while streaming',()=>{
  expect(cleanSuggestion(' the notes fr',input('Thanks for',{final:false}))).toBe(' the notes');
  expect(wholeWords(' th')).toBe('');
 });
 it('keeps a suggestion through matching keystrokes and Backspace, and lets go when the text differs',()=>{
  expect(remainder('Thanks for',' the notes.','Thanks for th')).toBe('e notes.');
  expect(remainder('Thanks for',' the notes.','Thanks for')).toBe(' the notes.');
  expect(remainder('Thanks for',' the notes.','Thanks for tx')).toBeNull();
  expect(remainder('Thanks for',' the notes.','Thanks fo')).toBeNull();
  expect(remainder('Thanks for',' the notes.','Thanks for the notes.')).toBeNull();
 });
});

describe('what a suggestion says about the writer comes from what is theirs',()=>{
 const page='Junior Video Editor. You would color grade in DaVinci Resolve. Which editing software do you use most, and for how long?';
 const base={after:'',singleLine:false,final:true,known:page};
 it('a job post naming its software is not their experience: the claim is cut',()=>{
  expect(cleanSuggestion(' DaVinci Resolve for the last three years.',{...base,before:'I mostly use',mine:'Dana Park'})).toBe('');
 });
 it('their own writing makes it theirs to say',()=>{
  expect(cleanSuggestion(' DaVinci Resolve, for three years now.',{...base,before:'I mostly use',mine:'I have been editing in DaVinci Resolve for three years now.'})).toBe(' DaVinci Resolve, for three years now.');
 });
 it('words that say nothing about them are checked as before',()=>{
  expect(cleanSuggestion(' take a look and get back to you.',{...base,before:'Thanks for the deck. I will',mine:''})).toBe(' take a look and get back to you.');
  expect(cleanSuggestion(' ask Sarah about it.',{...base,known:'Sarah: can you send the deck?',before:'Sure, I will',mine:''})).toBe(' ask Sarah about it.');
 });
});
