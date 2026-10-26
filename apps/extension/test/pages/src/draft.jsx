import {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {Editor,EditorState} from 'draft-js';
import 'draft-js/dist/Draft.css';
function App(){const [state,setState]=useState(()=>EditorState.createEmpty());return <Editor editorState={state} onChange={setState}/>;}
createRoot(document.getElementById('editor')).render(<App/>);
