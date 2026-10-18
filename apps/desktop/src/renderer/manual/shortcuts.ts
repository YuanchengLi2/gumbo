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
 {group:'Timeline',keys:['Esc'],label:'Clear the selection'},
 {group:'Timeline',keys:['N'],label:'Turn snapping on or off (hold Alt to skip it once)'},
 {group:'Timeline',keys:['+','−','0'],label:'Zoom in, out, or to fit'},
 {group:'Gumbo',keys:['Ctrl+L','/'],label:'Write to Gumbo'},
 {group:'Gumbo',keys:['?'],label:'Show these shortcuts'}
];
/** Whether a key event comes from a place that types (so single-letter shortcuts leave it alone). */
export const typing=(e:KeyboardEvent)=>!!(e.target as HTMLElement|null)?.closest?.('input,textarea,select,[contenteditable]');
