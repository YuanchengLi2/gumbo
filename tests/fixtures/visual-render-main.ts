import {app} from 'electron';
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {VisualRenderRequestSchema} from '@dream/contracts';
import {renderVisual} from '../../apps/desktop/src/sandbox/manager';
app.on('window-all-closed',()=>{});
async function run(){await app.whenReady();try{
 const [input,output]=process.argv.slice(2),request=VisualRenderRequestSchema.parse(JSON.parse(readFileSync(input,'utf8')));
 const result=await renderVisual(request.definition,request.assets,{runtimeDirectory:resolve('apps/desktop/resources/staged/sandbox'),cacheDirectory:resolve('artifacts/ai-visual-cache'),compilerWorker:resolve('artifacts/sandbox-acceptance/component-compile.cjs')},new AbortController().signal);writeFileSync(output,JSON.stringify(result));app.exit(0);
 }catch(error){console.error((error as Error).message);app.exit(1);}}
void run();
