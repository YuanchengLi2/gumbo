import {getDocument,GlobalWorkerOptions} from 'pdfjs-dist';
/** A PDF's words, page by page, for memory (background/memory/pdf.ts): Chrome shows PDFs in its own viewer, where no
 * extension's script may run, so the file itself is read here with pdf.js. Lines come out in reading order (pdf.js puts
 * the end of a line where the page does). A scanned PDF has no words in it: its pages come back empty and the engine
 * reads a picture of the screen instead. At most the first 60 pages. */
let worker:Worker|undefined;
export async function readPdf(url:string,maxPages=60):Promise<{title?:string;pages:string[]}>{
 worker??=new Worker(chrome.runtime.getURL('pdf.js'),{type:'module'});GlobalWorkerOptions.workerPort=worker;
 const response=await fetch(url,{credentials:'include'});if(!response.ok)throw new Error(`The PDF could not be read (${response.status}).`);
 const doc=await getDocument({data:new Uint8Array(await response.arrayBuffer()),isEvalSupported:false}).promise;
 try{
  const meta=await doc.getMetadata().catch(()=>undefined) as {info?:{Title?:string}}|undefined;
  const pages:string[]=[];
  for(let n=1;n<=Math.min(doc.numPages,maxPages);n++){
   const page=await doc.getPage(n),content=await page.getTextContent();
   let text='';for(const item of content.items as {str?:string;hasEOL?:boolean}[]){if(typeof item.str!=='string')continue;text+=item.str+(item.hasEOL?'\n':item.str&&!item.str.endsWith(' ')?' ':'');}
   pages.push(text.replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim());page.cleanup();
  }
  return{title:meta?.info?.Title?.trim()||undefined,pages};
 }finally{void doc.destroy();}
}
