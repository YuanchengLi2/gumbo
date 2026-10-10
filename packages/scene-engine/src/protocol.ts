/** The engine runtime version. Each published engine scene pins the version it was compiled against, and the
 * runtime for every shipped version stays available, so older scenes keep playing and exporting unchanged. */
export const ENGINE_VERSION=1;

/** Messages between the editor (player or export) and a scene document. Legacy HTML scenes use the same frame
 * request and acknowledgement, so the player and export treat both formats alike. */
export type FrameRequest={dreamScene:true;type:'frame';requestId:number;frame:number;fps:number};
export type SceneMessage=
 {dreamScene:true;ready:true}
 |{dreamScene:true;requestId:number}
 |{dreamScene:true;requestId?:number;error:string;stack?:string;fatal?:boolean};

/** The scene frame shown at a composition frame: the clip's source offset plus elapsed time at the clip's speed,
 * clamped to the scene's length. LiveScene and EngineScene use this exact formula. */
export function sceneFrameIndex(input:{frame:number;fps:number;sourceIn?:number;speed?:number;sceneFps:number;durationInFrames:number}){
 const {frame,fps,sourceIn=0,speed=1,sceneFps,durationInFrames}=input;
 return Math.max(0,Math.min(durationInFrames-1,Math.floor((sourceIn+Math.max(0,frame)/fps*speed)*sceneFps)));
}

/** What a published engine scene records about its compiled code (stored on the asset as scene.engine). */
export type EngineSceneInfo={version:number;chunks:string[];props?:Record<string,unknown>;assets?:string[];files?:Record<string,string>;transparent?:boolean};
