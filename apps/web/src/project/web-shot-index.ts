import {ShotIndexer as DesktopShotIndexer} from '../../../project-service/src/shot-index';
export * from '../../../project-service/src/shot-index';
/** The footage index on the web: the desktop's, without its background queue until the media worker reads frames the
 * way it asks for them (Phase 2). Saved indexes and their status still answer; nothing is indexed on import yet. */
export class ShotIndexer extends DesktopShotIndexer{override queue(_ids:string[]){}}
