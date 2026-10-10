// Prefer project overrides, then the read-only libraries shipped with Dream.
const {createRequire,registerHooks}=require('node:module');
const {pathToFileURL}=require('node:url');
const path=require('node:path');
const shared=process.env.DREAM_SHARED_NODE;
if(shared){
 const fallback=createRequire(path.join(shared,'package.json'));
 registerHooks({resolve(specifier,context,nextResolve){
  try{return nextResolve(specifier,context);}catch(error){
   if(!['ERR_MODULE_NOT_FOUND','MODULE_NOT_FOUND'].includes(error.code)||specifier.startsWith('.')||specifier.startsWith('/')||specifier.includes(':'))throw error;
   try{return nextResolve(pathToFileURL(fallback.resolve(specifier)).href,context);}catch{throw error;}
  }
 }});
}
