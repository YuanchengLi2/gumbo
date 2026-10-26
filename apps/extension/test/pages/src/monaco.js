import * as monaco from 'monaco-editor/editor/editor.api.js';
self.MonacoEnvironment={getWorker:()=>new Worker(URL.createObjectURL(new Blob(['self.onmessage=()=>{}'],{type:'text/javascript'})))};
const host=document.getElementById('editor');host.style.height='200px';host.style.padding='0';
window.editor=monaco.editor.create(host,{value:'',language:'plaintext',minimap:{enabled:false},fontFamily:'Arial',fontSize:16,lineHeight:24,lineNumbers:'off',glyphMargin:false,folding:false,wordWrap:'on',renderLineHighlight:'none',scrollBeyondLastLine:false,cursorStyle:'line-thin',cursorBlinking:'solid'});
