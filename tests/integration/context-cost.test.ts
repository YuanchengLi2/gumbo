import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {codePrompt} from '../../packages/orchestrator/src/code-prompt';
import {toolsFor,allowedTools,parseCodeTool} from '../../packages/orchestrator/src/code-tools';
import {briefing} from '../../packages/orchestrator/src/code-agent';
import {sceneReference,projectReference} from '../../packages/scene-engine/src/reference-parts';
import {wordLines,coverageSummary} from '../../apps/project-service/src/media-evidence';
import {fixedPrefix,imageSize,imageTokens} from '../../scripts/cost-anatomy';

// Every call re-reads the system prompt, the tools and the conversation, so these sizes are what each call costs.

it('keeps the editing agent\'s fixed prefix small: the project and scene references are read from context/ on demand',()=>{
 // About 250 tokens of it are the rule that the user's choices win and the editing-taste summary, and about 70 the
 // per-part finish report (October 13, 2026).
 // Raised from 7,700 on October 14, 2026 for the footage index (find_shots) and listening: core capabilities, not wording.
 // Lowered to 6,000 on October 17, 2026: the project-document reference moved to context/project.md, read before the
 // first edit of project.json (a reply or a search no longer carries it).
 const {editing}=fixedPrefix();expect(editing.system+editing.tools).toBeLessThan(6000);
 expect(codePrompt).not.toContain('## The project document');expect(codePrompt).toContain('read context/project.md');expect(codePrompt).toContain('read context/engine.md');expect(codePrompt).not.toContain('## @dream/engine');
 expect(projectReference).toContain('## The project document');
 expect(sceneReference).toContain('## @dream/engine');expect(sceneReference).toContain('## Example: score');
 // The two halves together are the whole reference.
 const api=readFileSync('packages/scene-engine/reference/api.md','utf8').replace(/\r\n/g,'\n');
 for(const heading of api.match(/^## .+$/gm)!)expect(projectReference.includes(heading)!==sceneReference.includes(heading)).toBe(true);
});

it('gives the model types and choices, not validation limits, which parsing still enforces (a number past its bounds is moved to the bound)',()=>{
 const tools=JSON.stringify(toolsFor('solo',{canDelegate:true}));
 expect(tools).not.toContain('maxLength');expect(tools).not.toContain('$schema');expect(tools).toContain('"enum"');
 expect(parseCodeTool('list_files',{offset:-1}).offset).toBe(0);expect(()=>parseCodeTool('list_files',{offset:'first'})).toThrow('offset');expect(parseCodeTool('set_project_title',{title:'x'.repeat(200)}).title).toHaveLength(80);
 expect(toolsFor('solo').find(t=>t.name==='view_media')!.input_schema.properties).toHaveProperty('detail');
});

it('offers replies the editing agent\'s exact tools, so both read one cached prefix, while replies still cannot change anything',()=>{
 const editing=allowedTools('solo',{canDelegate:true}),reply=allowedTools('readonly');
 expect(reply.has('write_file')).toBe(false);expect(reply.has('publish_project')).toBe(false);expect(reply.has('read_file')).toBe(true);expect(editing.has('write_file')).toBe(true);
 expect(()=>parseCodeTool('run_command',{command:'dir'},true,reply)).toThrow('unavailable');
});

it('writes timed words as one short line each and merges transcription coverage into spans',()=>{
 const lines=wordLines([{text:'Hello',start:1,end:1.456,speaker:'unknown',confidence:.9},{text:'there',start:1.5,end:1.9,confidence:.3},{text:'Yes',start:2.25,end:2.5,speaker:'B'}]);
 expect(lines).toBe('1 1.46 Hello\n1.5 1.9 there?\n2.25 2.5 [B] Yes');
 expect(coverageSummary({provider:'groq',status:'partial',ranges:[{start:30,end:120},{start:0,end:30},{start:150,end:210}]})).toEqual({provider:'groq',status:'partial',covered:'0-120s, 150-210s'});
 // About a sixth of a JSON object per word.
 const word={id:'a_927a36f3-ceaf-454c-a244-f95915f1af91:groq:6:121',assetId:'a_927a36f3-ceaf-454c-a244-f95915f1af91',text:'word',start:539.8,end:540.02,confidence:.82,speaker:'unknown',pauseBefore:0};
 expect(wordLines(Array(100).fill(word)).length*5).toBeLessThan(JSON.stringify(Array(100).fill(word)).length);
});

it('briefs the agent with the same facts in fewer words: library versions once, preset names as their combination, made media without paths',()=>{
 const presets=['Soft','Bright'].flatMap(a=>['whoosh','pop','hit'].map(b=>`${a} ${b}`));
 const context={capabilities:{sfx:{format:'preset:<name>',presets}},environment:{preview:'live',nodeDependencies:{react:'19.1.1'},sharedLibraries:{node:{react:'19.1.1'},python:{numpy:'2.2.6'}},pythonPackages:[{name:'numpy',version:'2.2.6'}]},media:[{assetId:'v',filename:'Talk.mp4',kind:'video',durationSec:20},{assetId:'code_abc',filename:'title',kind:'video',durationSec:3,width:1920,height:1080,fps:30,hasAudio:false,path:'../Media/Generated/abc/scene.js'}],computer:{now:'2026-10-12T00:00:00Z'},workspaceFolder:'W',projectDocument:'project.json',schema:'context/project-schema.json'};
 const [cached,request]=briefing(context,'Cut it',{projectTitle:'Talk'}) as any[];
 expect(cached.text).toContain('"nodeLibraries":"react 19.1.1"');expect(cached.text).toContain('"pythonLibraries":"numpy 2.2.6"');expect(cached.text).not.toContain('sharedLibraries');
 expect(cached.text).toContain('any of Soft, Bright followed by any of whoosh, pop, hit');
 expect(request.text).toContain('"generatedMedia":["code_abc title"]');
});

it('counts image tokens from the picture size, not its encoded text',()=>{
 // A 1x1 PNG header: the cost of an image is its pixels, never the length of its base64.
 const png=Buffer.from('89504e470d0a1a0a0000000d49484452000004000000024008020000','hex').toString('base64');
 expect(imageSize(png)).toEqual({width:1024,height:576});expect(imageTokens(1024,576)).toBe(787);expect(imageTokens(4000,3000)).toBeLessThan(1600);
});
