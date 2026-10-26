import {EditorView,basicSetup} from 'codemirror';
window.editor=new EditorView({doc:'',parent:document.getElementById('editor'),extensions:[basicSetup,EditorView.lineWrapping,EditorView.theme({
 '&':{fontSize:'16px'},'.cm-content':{fontFamily:'Arial, Helvetica, sans-serif',caretColor:'transparent',padding:'0'},'.cm-line':{padding:'0'},
 '&.cm-focused':{outline:'none'},'.cm-gutters':{display:'none'},'.cm-activeLine':{background:'transparent'},'.cm-cursor':{display:'none'},'.cm-scroller':{lineHeight:'1.5'}})]});
