import {createRoot} from 'react-dom/client';
import '../shared/tokens.css';
import {Bowl} from '../shared/Bowl';
/** The side panel: live captions and notes for what Gumbo hears, and later the agent. */
function Panel(){return <main style={{padding:16}}><Bowl size={24}/><p style={{color:'var(--n60)'}}>Captions and notes from meetings and videos show here.</p></main>;}
createRoot(document.getElementById('root')!).render(<Panel/>);
