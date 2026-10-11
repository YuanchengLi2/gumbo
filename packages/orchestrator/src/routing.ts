/** Only exact localized instructions take the inexpensive executor by default. */
export type RequestIntent='auto'|'plan'|'ask';
/** ask: the user chose chat only, so the request is answered and nothing changes. */
export function routeCodeRequest(text:string,intent:RequestIntent,interrupted=false){
 const planning=intent==='plan'||/^(?:please\s+)?(?:plan\b|help me plan\b|discuss\b)/i.test(text);
 // Carrying on with a stopped request; anything else after a stop is a new request.
 const continuing=interrupted&&intent==='auto'&&/^(?:(?:ok(?:ay)?|yes|please)[,.!]?\s+)?(?:continue|keep going|resume|go on|carry on|try again|retry)\b/i.test(text.trim());
 const question=/^(?:what|why|how|does|is|are|explain|can you explain)\b/i.test(text)&&! /\b(?:then|and)\s+(?:make|change|create|edit|shorten|render|apply|implement)\b/i.test(text);
 // Something to read before anything is built (a script, ideas, an outline or copy), with no request to build it now.
 const toRead=/\b(?:write|draft|think of|come up with|give me|suggest|brainstorm|make|show me)\b[^.?!]{0,40}\b(?:script|ideas?|outline|copy|concepts?|voiceover|storyboard)\b/i;
 const build=/\b(?:create|edit|shorten|render|apply|implement|build|animate|add|put|place|turn it into|make (?:it|the video|a video|an? (?:animated|short|video|clip|intro|scene)))\b/i;
 const reply=intent==='ask'||question||toRead.test(text)&&(/\b(?:first|before)\b/i.test(text)||!build.test(text));
 const exact=/\b\d+(?:\.\d+)?\s*(?:seconds?|secs?|s\b|db\b|%|pixels?|px|fps)|[“"].+[”"]/.test(text)&&/^(?:please\s+)?(?:trim|split|delete|remove|mute|unmute|set|change|move|replace|shorten)\b/i.test(text)&&! /urgent|elegant|feel|story|restructure|cinematic|better|beautiful|opening animation/i.test(text);
 const requiresPacing=/^(?:please\s+)?(?:shorten|trim)\b/i.test(text)&&! /\b(?:from|first|last|start|end|only clip)\b/i.test(text);
 if(continuing)return {route:'continue',intelligence:'haiku',complexity:'normal',reason:'Carry on with the stopped request.',requestedChanges:[] as string[]};
 return {route:planning&&intent!=='ask'?'plan':reply?'question':'local',intelligence:'haiku' as 'haiku'|'sonnet'|'opus',complexity:exact&&!requiresPacing?'simple':reply?'normal':'difficult',reason:exact&&!requiresPacing?'Exact localized change.':reply?'The user wants something to read.':'Open-ended creative direction or implementation.',requestedChanges:reply?[]:[text]};
}
