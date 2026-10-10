export const defaults={fps:30,width:1920,height:1080,proxyHeight:720,highlightMs:1500,animationMs:300,maxToolCalls:40,maxReviewRounds:2,maxSourceHours:2,maxProjectHours:4,frameSampleSec:2,faceSampleSec:.5,model:'large-v3-turbo'} as const;
/** Haiku works alone by default; Opus only orchestrates multi-part creative work, dispatching Haiku workers, and a request can switch between the two. */
export const models={director:'claude-opus-5-5',lead:'claude-opus-5-5',editor:'claude-haiku-5-5',worker:'claude-haiku-5-5',router:'claude-haiku-5-5'};

// Working targets trigger archival of completed exchanges, not task failure. Haiku stays under its 100K price tier.
export const engineBudgets={routerInput:12000,workingInput:180000,haikuInput:90000,maxOutput:64000,toolCalls:40,leadSteps:60,agentSteps:80,maxWorkers:4,modeSwitches:2,textNudges:2,readCalls:12,readRequests:16,cacheBytes:5*1024**3} as const;
