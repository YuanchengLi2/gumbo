import {z} from 'zod';
import type {ProjectDB} from '@dream/project-db';
import {GenerationSchema,type GenerationCommand,type GenerationResult,type LibraryRevision} from './library';
import {VisualCommandSchema,type VisualCommand,type VisualResult,type VisualRevision} from './visuals';

export const CreationCommandSchema=z.union([GenerationSchema,VisualCommandSchema]);
export type CreationCommand=z.infer<typeof CreationCommandSchema>;
export type CreationResult=GenerationResult|VisualResult;
export type CreationKind='audio'|'visual';

/** One project-owned execution boundary for the director and desktop commands. */
export interface EditingEnginePort{
 readonly capabilities:readonly CreationKind[];
 visualSource?(name:string,input:any):any;
 apply:ProjectDB['apply'];
 generate(command:GenerationCommand,turnId?:string,signal?:AbortSignal):Promise<GenerationResult>;
 generate(command:VisualCommand,turnId?:string,signal?:AbortSignal):Promise<VisualResult>;
 list(kind:'audio'):LibraryRevision[];
 list(kind:'visual'):VisualRevision[];
 get(revisionId:string):LibraryRevision|VisualRevision;
}
