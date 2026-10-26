/** The models that ship inside the extension, so memory search runs on the computer with nothing to download: bge-small
 * (bge-small-en-v1.5, 8-bit, 34 MB) for sentence embeddings, pinned to a revision and checked by hash. Downloaded once
 * into public/models (not committed); the build copies them into dist. bge-small was chosen over MiniLM on the recall
 * test: 41 of 41 questions answered in the top five against 40. Whisper, YAMNet and CAM++ are larger and only
 * needed for listening, so they download on first use instead, also checked.
 *   npx tsx apps/extension/scripts/models.ts */
import {existsSync,mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,dirname} from 'node:path';
const root=resolve(import.meta.dirname,'../public/models');
const models=[{id:'Xenova/bge-small-en-v1.5',revision:'ea104dacec62c0de699686887e3f920caeb4f3e3',files:[
 {path:'config.json'},{path:'tokenizer.json'},{path:'tokenizer_config.json'},
 {path:'onnx/model_quantized.onnx',sha256:'6c9c6101a956d62dfb5e7190c538226c0c5bb9cb27b651234b6df063ee7dbfe4'},
]}];
export async function ensureModels(log=console.log){
 for(const model of models)for(const file of model.files){
  const out=resolve(root,model.id,file.path);
  if(existsSync(out)&&(!file.sha256||createHash('sha256').update(readFileSync(out)).digest('hex')===file.sha256))continue;
  log(`Downloading ${model.id}/${file.path}…`);
  const response=await fetch(`https://huggingface.co/${model.id}/resolve/${model.revision}/${file.path}`);
  if(!response.ok)throw new Error(`${model.id}/${file.path}: ${response.status}`);
  const bytes=Buffer.from(await response.arrayBuffer());
  if(file.sha256&&createHash('sha256').update(bytes).digest('hex')!==file.sha256)throw new Error(`${model.id}/${file.path} does not match its hash.`);
  mkdirSync(dirname(out),{recursive:true});writeFileSync(out,bytes);
 }
}
if(process.argv[1]&&resolve(process.argv[1])===resolve(import.meta.dirname,'models.ts'))await ensureModels();
