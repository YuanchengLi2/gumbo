export const defaults={fps:30,width:1920,height:1080,proxyHeight:720,highlightMs:1500,animationMs:300,maxToolCalls:40,maxReviewRounds:2,maxSourceHours:2,maxProjectHours:4,frameSampleSec:2,faceSampleSec:.5,model:'large-v3-turbo'} as const;
/** Haiku starts every request and works alone. Sonnet takes over when Haiku keeps failing, and directs Haiku workers when
 * a request builds several new pieces at once; Opus only when Sonnet also fails, for a whole new video, or when asked. */
export const models={director:'claude-opus-5-5',lead:'claude-opus-5-5',sonnet:'claude-sonnet-5-5',editor:'claude-haiku-5-5',worker:'claude-haiku-5-5',router:'claude-haiku-5-5'};

// Working targets trigger archival of completed exchanges, not task failure. Haiku compacts at 80K and is never sent
// more than 96K, so it stays under its 100K long-context price tier.
export const engineBudgets={routerInput:12000,workingInput:180000,haikuInput:80000,haikuHardInput:96000,maxOutput:64000,toolCalls:40,leadSteps:100,agentSteps:80,maxWorkers:4,modeSwitches:2,textNudges:2,readCalls:12,readRequests:16,cacheBytes:5*1024**3} as const;
export * from './pricing';
