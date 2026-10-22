/** The editor's keyboard shortcuts, after OpenCut's defaults (apps/web/src/actions/definitions.ts in OpenCut Classic):
 * the same keys do the same things in both layouts. Ctrl is Cmd on a Mac. Press ? to see them in the app. */
export const EDITOR_SHORTCUTS:{group:string;keys:string[];label:string}[]=[
 {group:'Playback',keys:['Space','K'],label:'Play or pause'},
 {group:'Playback',keys:['J','L'],label:'Back or forward one second'},
 {group:'Playback',keys:['←','→'],label:'Back or forward one frame'},
 {group:'Playback',keys:['Shift+←','Shift+→'],label:'Back or forward five seconds'},
 {group:'Playback',keys:['Home','End'],label:'Go to the start or the end'},
 {group:'Editing',keys:['S','Ctrl+B'],label:'Split at the playhead'},
 {group:'Editing',keys:['Q'],label:'Split and remove the left part'},
 {group:'Editing',keys:['W'],label:'Split and remove the right part'},
 {group:'Editing',keys:['Delete','Backspace'],label:'Delete the selection'},
 {group:'Editing',keys:['Ctrl+D'],label:'Duplicate the selection'},
 {group:'Editing',keys:['Ctrl+C','Ctrl+V'],label:'Copy, and paste at the playhead'},
 {group:'Editing',keys:['Ctrl+Z','Ctrl+Shift+Z'],label:'Undo or redo'},
 {group:'Timeline',keys:['Ctrl+A'],label:'Select everything'},
 {group:'Timeline',keys:['Esc'],label:'Cancel a drag, or clear the selection'},
 {group:'Timeline',keys:['Wheel','Shift+Wheel'],label:'Scroll through time'},
 {group:'Timeline',keys:['Ctrl+Wheel'],label:'Zoom at the pointer'},
 {group:'Timeline',keys:['N'],label:'Turn snapping on or off (hold Alt to skip it once)'},
 {group:'Timeline',keys:['+','−','0'],label:'Zoom in, out, or to fit'},
 {group:'Gumbo',keys:['Ctrl+L','/'],label:'Write to Gumbo'},
 {group:'Gumbo',keys:['?'],label:'Show these shortcuts'}
];
/** The text field keys belong to. Focus can vanish from a field without the user moving it: the field is removed, hidden
 * or disabled while they type (the editor layout coming back when Gumbo finishes takes the chat box away mid-sentence),
 * and the next letters landed on the timeline as shortcuts (S split, Space played). The blur that comes with it is not
 * the user leaving: until focus really moves (a click, Tab, a blur of a field still there), a key pressed with focus on
 * nothing is still the field's. */
export function keyOwner<T>(){let field:T|null=null;return{
 focusIn(target:T,text:boolean){field=text?target:null;},
 /** `stillThere`: the field is on the page, shown and enabled after the blur. */
 focusOut(target:T,stillThere:boolean){if(target===field&&stillThere)field=null;},
 pressed(){field=null;},
 /** The field a key with focus on nothing belongs to, if any. */
 orphan(onNothing:boolean){return onNothing?field:null;}};}
const TEXT='textarea,[contenteditable],input:not([type=range],[type=checkbox],[type=radio],[type=button],[type=submit],[type=color],[type=file])';
const owner=keyOwner<HTMLElement>(),typed=new WeakSet<Event>();
if(typeof document!=='undefined'){
 document.addEventListener('focusin',e=>{const t=e.target as HTMLElement;owner.focusIn(t,!!t.matches?.(TEXT));},true);
 // Looked at once the blur is over: a field being removed can still be on the page while its blur is sent.
 const there=(t:HTMLElement)=>t.isConnected&&t.getClientRects().length>0&&!(t as HTMLTextAreaElement).disabled;
 document.addEventListener('focusout',e=>{const t=e.target as HTMLElement;queueMicrotask(()=>owner.focusOut(t,there(t)));},true);
 document.addEventListener('pointerdown',()=>owner.pressed(),true);
 // First of the window's key handlers: the key goes back to its field (or the chat box), and no shortcut acts on it.
 window.addEventListener('keydown',e=>{const active=document.activeElement,field=owner.orphan(!active||active===document.body||active===document.documentElement);if(!field)return;typed.add(e);
  const back=there(field)?field:document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Ask Gumbo to edit"]');back?.focus();},true);
}
/** Whether a key event comes from a place that types (so single-letter shortcuts leave it alone). */
export const typing=(e:KeyboardEvent)=>typed.has(e)||!!(e.target as HTMLElement|null)?.closest?.('input,textarea,select,[contenteditable]');
