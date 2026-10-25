export const defaults={fps:30,width:1920,height:1080,proxyHeight:720,highlightMs:1500,animationMs:300,maxToolCalls:40,maxReviewRounds:2,maxSourceHours:2,maxProjectHours:4,frameSampleSec:2,faceSampleSec:.5,model:'large-v3-turbo'} as const;
/** One model does all the work: the router, the editing agent, its helpers, plans and replies. DREAM_AGENT_MODEL swaps it
 * for a measured comparison (for example claude-haiku-5-5); Sonnet is the default. */
const chosenModel=typeof process!=='undefined'?process.env?.DREAM_AGENT_MODEL:undefined;
export const models={agent:chosenModel&&/^claude-(haiku|sonnet|opus)-5-5$/.test(chosenModel)?chosenModel:'claude-sonnet-5-5'};

// Roux's limits. A conversation is compacted past workingInput tokens (a summary re-sends it at the full price, while
// cached re-reads cost a tenth, so it happens rarely); on Haiku past haikuInput, to stay under its 100K long-context price.
// A run pauses to check in after requestSpendUsd of spending or requestMinutes of time; continue goes on. maxOutput is the
// most one reply may write.
export const engineBudgets={workingInput:90000,haikuInput:60000,requestSpendUsd:.5,requestMinutes:30,maxOutput:64000};
export * from './pricing';
export * from './models';
export * from './creator-styles';
export * from './media-urls';
