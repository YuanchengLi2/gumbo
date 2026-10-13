import {engineReference} from './reference.generated';
// The project-document half is what every edit needs, so it stays in the editing agent's system prompt. The music and sound
// half (scores and sound design) only matters when music or a sound is written, so the workspace keeps it in
// context/engine.md for the agent to read then, instead of every call carrying it.
const split=engineReference.indexOf('\n## Music and sound effects');
export const projectReference=split<0?engineReference:engineReference.slice(0,split).replace(' This reference is complete: you do not need to search the workspace for engine, score or project-document formats.','');
export const sceneReference=split<0?'':'# Dream engine: writing music and sound\n\nThis is complete: you do not need to search the workspace for score or sound formats.\n'+engineReference.slice(split);
