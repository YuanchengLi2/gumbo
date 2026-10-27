/** The numbers memory and Tab are tuned by (memory/config.ts reads them with what the user or tab-eval overrides). */
export type MemoryConfig={
 rank:{cos:number;bm25:number;recency:number;project:number;chain:number;site:number;seen:number;useful:number;tauSessionMs:number;tauPastMs:number;mmr:number};
 projects:{join:number;chainBonus:number;siteBonus:number;chainWindowMs:number;promoteVisits:number;promoteMs:number;noteVisits:number;noteActiveMs:number;noteGapMs:number};
 profile:{everyWritings:number;everyMs:number};
 text:{requestGapMs:number;beatMs:number;chainDepth:number;maxTokensMulti:number;maxTokensSingle:number;alternatives:number};
 action:{beatMs:number;dwellMs:number;margin:number};
};
const MINUTE=60_000;
export const defaults:MemoryConfig={
 rank:{cos:0.35,bm25:0.2,recency:0.15,project:0.1,chain:0.1,site:0.05,seen:0.05,useful:0.05,tauSessionMs:60*MINUTE,tauPastMs:3*24*60*MINUTE,mmr:0.7},
 // Measured on the first computer (Oct 27, 1,332 visits): unrelated title pairs p90 0.68, pairs reached one from the
 // other p10 0.61 (so the chain bonus brings those in).
 projects:{join:0.7,chainBonus:0.15,siteBonus:0.1,chainWindowMs:30*MINUTE,promoteVisits:3,promoteMs:5*MINUTE,noteVisits:5,noteActiveMs:10*MINUTE,noteGapMs:15*MINUTE},
 profile:{everyWritings:20,everyMs:24*60*MINUTE},
 text:{requestGapMs:300,beatMs:250,chainDepth:1,maxTokensMulti:120,maxTokensSingle:30,alternatives:3},
 action:{beatMs:250,dwellMs:1500,margin:0.1},
};
