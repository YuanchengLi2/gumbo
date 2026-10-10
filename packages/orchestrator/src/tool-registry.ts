/** Stable names/order form the cached capability prefix. Mutations remain sequential. */
export function stableTools<T extends {name:string}>(tools:T[]):T[]{const names=new Set<string>();for(const tool of tools){if(names.has(tool.name))throw new Error('Duplicate tool registration: '+tool.name);names.add(tool.name);}return [...tools].sort((a,b)=>a.name.localeCompare(b.name));}
export const isMutationTool=(name:string)=>['computer_files','import_computer_media','apply_ops','create_visual','commit_visual_draft','generate_music','generate_sfx','create_score','create_sfx','edit_score'].includes(name);
export const resultBudget=16000;
