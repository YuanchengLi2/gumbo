import {engineReference} from './reference.generated';
// The reference in two guides the agent reads when the work needs them (guides/ in the workspace): the project document
// (project.json: clips, keyframes, items, effects, text), which every edit uses, and writing scenes and sound, which only
// matters when one is written. The reference's opening paragraph is about scenes, so it goes with the second.
const documentAt=engineReference.indexOf('\n## The project document'),scenesAt=engineReference.indexOf('\n## Available imports');
const intro=engineReference.slice(engineReference.indexOf('\n')+1,documentAt<0?0:documentAt).replace(' This reference is complete: you do not need to search the workspace for engine, score or project-document formats.','').trim();
export const projectReference=documentAt<0||scenesAt<0?engineReference:'# The edit: project.json\n\nThis is complete: you do not need to search the workspace for the project document\'s format.\n'+engineReference.slice(documentAt,scenesAt);
export const sceneReference=documentAt<0||scenesAt<0?'':`# Dream scene engine: writing scenes, music and sound\n\n${intro} This is complete: you do not need to search the workspace for engine or score formats.\n`+engineReference.slice(scenesAt);
