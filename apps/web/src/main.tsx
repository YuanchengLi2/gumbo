import {createBridge,finishPendingSignIn,returnToSite} from './bridge';
import {missing,unsupportedPage} from './gate';
import './web.css';

/** Gumbo on the web starts here: check the browser has what the editor needs, put window.dream in place before the
 * editor's modules load (they read it, and @dream/config reads dream.web to pick the media routes), register the service
 * worker that serves /app/media/ and /app/engine/, then load the editor. */
async function start(){
 const gaps=missing();if(gaps.length){unsupportedPage(gaps);return;}
 (window as any).dream=createBridge();
 await navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`,{scope:import.meta.env.BASE_URL,type:'module'});
 await navigator.serviceWorker.ready;
 await finishPendingSignIn();
 if(await returnToSite())return;
 await import('./editor');
}
void start();
