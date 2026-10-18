import {create} from 'zustand';

/** What is typed in the workspace's chat box. It is kept apart from the app's state because every change there re-renders
 * the whole workspace: on a long edit each keystroke took over 100 ms. Only the chat box follows this; sending reads it. */
export const useDraft=create<{text:string}>(()=>({text:''}));
export const setDraft=(value:string|((old:string)=>string))=>useDraft.setState(s=>({text:typeof value==='function'?value(s.text):value}));
