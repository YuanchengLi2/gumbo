import {parentPort,workerData} from 'node:worker_threads';
import Ajv from 'ajv';
import {VisualDefinitionSchema} from '@dream/contracts';
import {compileVisualGraph} from '../sandbox/compile';
try{const definition=VisualDefinitionSchema.parse(workerData),validate=new Ajv({strict:false,allErrors:true,validateFormats:false}).compile(definition.parameterSchema);if(!validate(definition.parameters))throw new Error(`Visual parameters do not match their schema: ${JSON.stringify(validate.errors)}`);parentPort!.postMessage({code:compileVisualGraph(definition)});}catch(error){parentPort!.postMessage({error:(error as Error).message});}
