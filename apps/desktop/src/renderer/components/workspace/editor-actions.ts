import {createContext,useContext} from 'react';
import type {Op} from '@dream/timeline';

/** What chat cards and side panels can do to the editor: pick something on the timeline (selecting it, moving the playhead
 * to it and lighting it up), and apply operations as one undoable change. */
export type EditorActions={focus:(id:string|undefined,startSec?:number)=>void;apply:(ops:Op[],label:string)=>Promise<boolean>;locked:boolean};
export const EditorActionsContext=createContext<EditorActions|null>(null);
export const useEditorActions=()=>useContext(EditorActionsContext);
