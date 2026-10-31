/** The sentence embedding model memory search uses, shipped inside the extension (scripts/models.ts): bge-small, which
 * reads a question with an instruction before it and takes its first token's vector as the sentence's. */
export const EMBEDDING={model:'Xenova/bge-small-en-v1.5',pooling:'cls' as const,query:'Represent this sentence for searching relevant passages: '};
export const forQuery=(q:string)=>EMBEDDING.query+q;
/** Between the readings of a focus (offscreen/memory.ts): a question that may be about itself or about what is selected
 * is embedded both ways, and a memory is as close as its closest reading. */
export const READINGS='\u0002';
/** What a document is embedded as: its title, then the start of its text (about 250 tokens: a passage of memory is a few
 * hundred characters, and a longer text costs the one embedding thread far more than it adds). */
export const forDoc=(d:{title:string;text:string})=>`${d.title}\n${d.text}`.slice(0,1000);
/** How many texts go to the embedding model at once. It has one thread: small batches let what a person waits for (a
 * search's question, the moment's few nodes) get in between the background's, so no question waits on a backlog. */
export const EMBED_BATCH=8;
