import {Editor} from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
const host=document.getElementById('editor');host.style.padding='0';
window.editor=new Editor({element:host,extensions:[StarterKit],content:'',editorProps:{attributes:{style:'outline:none;min-height:120px;padding:10px'}}});
const style=document.createElement('style');style.textContent='.ProseMirror p{margin:0}';document.head.appendChild(style);
