import {posix} from 'node:path';
import {createHash} from 'node:crypto';
import type {VisualDefinition} from '@dream/contracts';
import ts from 'typescript';

const modules:Record<string,string>={react:'./runtime/react.js','react/jsx-runtime':'./runtime/jsx-runtime.js',remotion:'./runtime/remotion.js'};
/** Transpilation only: generated modules are never imported into this process. */
export function compileVisual(source:string,resolveModule:(name:string)=>string|undefined=name=>modules[name]){
 const file=ts.createSourceFile('component.tsx',source,ts.ScriptTarget.ES2022,true,ts.ScriptKind.TSX),errors:string[]=[];
 const checkModule=(node:ts.Node)=>{if(!ts.isStringLiteral(node)||!resolveModule(node.text))errors.push('Imports must use react, react/jsx-runtime or remotion. Supply footage through the assets prop.');};
 function visit(node:ts.Node){
  if(ts.isImportDeclaration(node)||ts.isExportDeclaration(node)&&node.moduleSpecifier)checkModule(node.moduleSpecifier!);
  if(ts.isImportEqualsDeclaration(node))errors.push('CommonJS imports are unavailable in visual components.');
  if(ts.isCallExpression(node)&&(node.expression.kind===ts.SyntaxKind.ImportKeyword||ts.isIdentifier(node.expression)&&node.expression.text==='require'))errors.push('Use static ES module imports in visual components.');
  ts.forEachChild(node,visit);
 }
 visit(file);if(errors.length)throw new Error([...new Set(errors)].join('\n'));
 const rewrite:ts.TransformerFactory<ts.SourceFile>=context=>root=>ts.visitNode(root,function transform(node:ts.Node):ts.VisitResult<ts.Node>{
  if(ts.isImportDeclaration(node)&&ts.isStringLiteral(node.moduleSpecifier)){const target=resolveModule(node.moduleSpecifier.text);if(!target)throw new Error('Unsupported generated import.');return context.factory.updateImportDeclaration(node,node.modifiers,node.importClause,context.factory.createStringLiteral(target),node.attributes);}
  if(ts.isExportDeclaration(node)&&node.moduleSpecifier&&ts.isStringLiteral(node.moduleSpecifier)){const target=resolveModule(node.moduleSpecifier.text);if(!target)throw new Error('Unsupported generated export.');return context.factory.updateExportDeclaration(node,node.modifiers,node.isTypeOnly,node.exportClause,context.factory.createStringLiteral(target),node.attributes);}
  return ts.visitEachChild(node,transform,context);
 }) as ts.SourceFile;
 const result=ts.transpileModule(source,{fileName:'component.tsx',reportDiagnostics:true,compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.ESNext,jsx:ts.JsxEmit.ReactJSX,isolatedModules:true,sourceMap:false},transformers:{after:[rewrite]}});
 const diagnostics=(result.diagnostics??[]).filter(d=>d.category===ts.DiagnosticCategory.Error);if(diagnostics.length)throw new Error(diagnostics.map(d=>ts.flattenDiagnosticMessageText(d.messageText,' ')).join('\n'));
 return result.outputText;
}

export type CompiledVisual={entry:string;files:Record<string,string>};
export function compileVisualGraph(definition:VisualDefinition):string|CompiledVisual{
 if(definition.schemaVersion===1){if(!definition.code)throw new Error('Visual source is empty.');return compileVisual(definition.code);}
 const sources=definition.moduleSources,manifest=definition.source;if(!sources||!manifest||!sources[manifest.entry])throw new Error('Resolved visual modules are missing.');
 const names=Object.keys(sources);if(names.length>64||Object.values(sources).reduce((n,s)=>n+s.length,0)>250000)throw new Error('Visual module graph exceeds its source budget.');
 const outputs=new Map<string,string>();
 for(const name of names){if(!/^(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+\.(?:tsx?|jsx?)$/.test(name))throw new Error('Invalid visual module path.');const hash=createHash('sha256').update(sources[name]).digest('hex');if(manifest.modules[name]!==hash)throw new Error('Module source hash mismatch.');outputs.set(name,'module-'+createHash('sha256').update(name).digest('hex')+'.js');}
 const files:Record<string,string>={};
 for(const name of names){const resolve=(specifier:string)=>{if(modules[specifier])return modules[specifier];if(!specifier.startsWith('./')&&!specifier.startsWith('../'))return;const path=posix.normalize(posix.join(posix.dirname(name),specifier));if(path.startsWith('../'))return;const found=[path,...['.tsx','.ts','.jsx','.js','/index.tsx','/index.ts'].map(ext=>path+ext)].find(candidate=>outputs.has(candidate));return found?'./'+outputs.get(found):undefined;};files[outputs.get(name)!]=compileVisual(sources[name],resolve);}
 files['component.js']=`export {default} from './${outputs.get(manifest.entry)}';`;return{entry:'component.js',files};
}
