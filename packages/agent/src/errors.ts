import type {FileProposal} from '@dream/contracts';

/** A model call that failed after its own retries. code says how: quota, authentication, stalled, truncated, unavailable… */
export class InferenceError extends Error {
 thinkingOnly?:boolean;
 constructor(message:string,public code:string,public httpStatus?:number){super(message);this.name='InferenceError';}
}
/** The run needs the user: computer file access, or a decision on proposed file changes. The request waits and resumes. */
export class FileApprovalRequired extends Error {
 constructor(public proposal?:FileProposal){super(proposal?'Review the proposed file changes.':'Allow computer file access to continue.');}
}
