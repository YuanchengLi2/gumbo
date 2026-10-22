/** Where media files and engine scene documents are served. The desktop app answers its own dream-media:// and
 * dream-engine:// protocols; the web app's service worker answers the same paths under routes the web bridge names
 * (dream.routes), since a service worker never sees requests to a custom scheme. The bridge is in place before the
 * editor's modules load. */
const routes=(globalThis as {dream?:{routes?:{media:string;engine:string}}}).dream?.routes;
export const MEDIA=routes?.media??'dream-media://';
export const ENGINE=routes?.engine??'dream-engine://';
