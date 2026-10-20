export const defaults={fps:30,width:1920,height:1080,proxyHeight:720,highlightMs:1500,animationMs:300,maxToolCalls:40,maxReviewRounds:2,maxSourceHours:2,maxProjectHours:4,frameSampleSec:2,faceSampleSec:.5,model:'large-v3-turbo'} as const;
/** One model does all the work: the router, the editing agent, its helpers, plans and replies. DREAM_AGENT_MODEL swaps it
 * for a measured comparison (for example claude-haiku-5-5); Sonnet is the default. */
const chosenModel=typeof process!=='undefined'?process.env?.DREAM_AGENT_MODEL:undefined;
export const models={agent:chosenModel&&/^claude-(haiku|sonnet|opus)-5-5$/.test(chosenModel)?chosenModel:'claude-sonnet-5-5'};

// Working targets trigger archival of completed exchanges, not task failure. Haiku compacts at 80K and is never sent
// more than 96K, so it stays under its 100K long-context price tier.
// The editing agent summarizes past 90K (was 60K): a summary re-sends the conversation at the full price (about five
// credits on GPT-6.1 Sol) while cached re-reads cost a tenth, so summarizing every two minutes cost more than it saved.
export const engineBudgets={routerInput:12000,workingInput:90000,haikuInput:60000,compactTo:20000,compactGap:6,compactGrowth:25000,requestSpendUsd:.5,haikuHardInput:96000,maxOutput:64000,toolCalls:40,agentSteps:80,rouxSteps:200,maxWorkers:4,textNudges:2,readCalls:12,readRequests:16,cacheBytes:5*1024**3} as const;
export * from './pricing';
export * from './models';
export * from './creator-styles';
