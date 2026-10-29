/** The numbers memory and Tab are tuned by (memory/config.ts reads them with what the user or tab-eval overrides). */
export type MemoryConfig={
 rank:{cos:number;bm25:number;recency:number;project:number;chain:number;site:number;seen:number;useful:number;tauSessionMs:number;tauPastMs:number;mmr:number;
  /** Memory from the past is given only when it is really about the moment: this close in meaning, or this strong a word
   * match (relative to the best). A loose match steers a suggestion somewhere the user is not going. */minCos:number;minBm25:number};
 projects:{join:number;chainBonus:number;siteBonus:number;chainWindowMs:number;promoteVisits:number;promoteMs:number;noteVisits:number;noteActiveMs:number;noteGapMs:number};
 profile:{everyWritings:number;everyMs:number};
 text:{requestGapMs:number;beatMs:number;chainDepth:number;maxTokensMulti:number;maxTokensSingle:number;alternatives:number};
 action:{beatMs:number;dwellMs:number;margin:number};
};
const MINUTE=60_000;
export const defaults:MemoryConfig={
 // Oct 27, after real use: what is retrieved is what is relevant, with no rule about where it comes from (no bonus or
 // penalty for the same site, project or tab). Closeness in meaning decides; how recently it was seen and whether it was
 // really read break ties, so what they read a few minutes ago comes before last week's page on the same subject.
 rank:{cos:0.55,bm25:0.15,recency:0.2,project:0,chain:0,site:0,seen:0.1,useful:0,tauSessionMs:30*MINUTE,tauPastMs:2*24*60*MINUTE,mmr:0.7,minCos:0.45,minBm25:0.6},
 // Measured on the first computer (Oct 27, 1,332 visits): unrelated title pairs p90 0.68, pairs reached one from the
 // other p10 0.61 (so the chain bonus brings those in).
 projects:{join:0.7,chainBonus:0.15,siteBonus:0.1,chainWindowMs:30*MINUTE,promoteVisits:3,promoteMs:5*MINUTE,noteVisits:5,noteActiveMs:10*MINUTE,noteGapMs:15*MINUTE},
 profile:{everyWritings:20,everyMs:24*60*MINUTE},
 text:{requestGapMs:300,beatMs:250,chainDepth:1,maxTokensMulti:45,maxTokensSingle:25,alternatives:3},
 action:{beatMs:250,dwellMs:1500,margin:0.1},
};
