import {ClassicEditor,Essentials,Paragraph,Bold,Italic} from 'ckeditor5';
import 'ckeditor5/ckeditor5.css';
const host=document.getElementById('editor');host.style.cssText='width:582px;border:0;padding:0;min-height:0';
ClassicEditor.create(host.appendChild(document.createElement('div')),{licenseKey:'GPL',plugins:[Essentials,Paragraph,Bold,Italic],toolbar:[]}).then(editor=>{window.editor=editor;});
const style=document.createElement('style');style.textContent='.ck.ck-editor__editable_inline{font:16px/1.5 Arial,Helvetica,sans-serif;color:#111;min-height:120px;padding:0 10px!important}.ck-content p{margin:0!important}.ck.ck-editor__editable.ck-focused{box-shadow:none!important;border-color:#bbb!important}.ck-editor__top{display:none}';document.head.appendChild(style);
