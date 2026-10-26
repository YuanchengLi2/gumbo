import {createEditor} from 'lexical';
import {registerRichText} from '@lexical/rich-text';
import {registerHistory,createEmptyHistoryState} from '@lexical/history';
const root=document.getElementById('editor');root.contentEditable='true';
const editor=createEditor({namespace:'test',onError:error=>{throw error;},theme:{paragraph:'p'}});
editor.setRootElement(root);registerRichText(editor);registerHistory(editor,createEmptyHistoryState(),300);
window.editor=editor;
const style=document.createElement('style');style.textContent='#editor p{margin:0}';document.head.appendChild(style);
