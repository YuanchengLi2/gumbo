import Quill from 'quill';
import 'quill/dist/quill.core.css';
window.editor=new Quill('#editor',{});
const style=document.createElement('style');style.textContent='.ql-container{font:inherit}.ql-editor{padding:0;font:16px/1.5 Arial,Helvetica,sans-serif;outline:none;min-height:120px}.ql-editor p{margin:0}';document.head.appendChild(style);
