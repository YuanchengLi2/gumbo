import {engineReference} from './reference.generated';
// The project-document half is what every edit needs, so it stays in the editing agent's system prompt. The scene-authoring
// half (imports, @dream/engine, frame rules, scores, examples) only matters when a scene or sound is written, so the
// workspace keeps it in context/engine.md for the agent to read then, instead of every call carrying it.
const split=engineReference.indexOf('\n## Available imports');
export const projectReference=split<0?engineReference:engineReference.slice(0,split).replace(' This reference is complete: you do not need to search the workspace for engine, score or project-document formats.','');
export const sceneReference=split<0?'':'# Dream scene engine: writing scenes, music and sound\n\nThis is complete: you do not need to search the workspace for engine or score formats.\n'+engineReference.slice(split);
