import {useMemo} from 'react';
import {createRoot} from 'react-dom/client';
import {createEditor} from 'slate';
import {Slate,Editable,withReact} from 'slate-react';
import {withHistory} from 'slate-history';
function App(){
 const editor=useMemo(()=>withHistory(withReact(createEditor())),[]);window.editor=editor;
 return <Slate editor={editor} initialValue={[{type:'paragraph',children:[{text:''}]}]}><Editable style={{outline:'none',minHeight:120}} renderElement={({attributes,children})=><p {...attributes} style={{margin:0}}>{children}</p>}/></Slate>;
}
createRoot(document.getElementById('editor')).render(<App/>);
