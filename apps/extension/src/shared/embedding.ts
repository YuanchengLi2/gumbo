/** The sentence embedding model memory search uses, shipped inside the extension (scripts/models.ts): bge-small, which
 * reads a question with an instruction before it and takes its first token's vector as the sentence's. */
export const EMBEDDING={model:'Xenova/bge-small-en-v1.5',pooling:'cls' as const,query:'Represent this sentence for searching relevant passages: '};
export const forQuery=(q:string)=>EMBEDDING.query+q;
/** What a document is embedded as: its title, then its text (the start of it: the model reads 512 tokens). */
export const forDoc=(d:{title:string;text:string})=>`${d.title}\n${d.text}`.slice(0,1800);
