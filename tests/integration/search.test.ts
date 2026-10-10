import {it,expect} from 'vitest';
import {mkdtempSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {ProjectDB} from '@dream/project-db';

it('ranks local vectors by cosine similarity and keeps model revisions isolated across reopen',()=>{
 const folder=mkdtempSync(join(tmpdir(),'dream-search-'));let db=new ProjectDB(folder,'Search');
 try{db.saveRecords('shots',[{id:'mountain',assetId:'a',start:0,end:3,framePaths:[],log:{description:'A mountain peak',tags:['landscape'],framing:'wide',energy:'low',usableAsBroll:true}},{id:'desk',assetId:'b',start:0,end:3,framePaths:[],log:{description:'Desk product',tags:['product'],framing:'close',energy:'low',usableAsBroll:true}}]);db.saveEmbeddings('siglip-test',[{id:'mountain',assetId:'a',vector:[1,0,0]},{id:'desk',assetId:'b',vector:[0,1,0]}]);db.saveEmbeddings('different-model',[{id:'desk',assetId:'b',vector:[1,0,0]}]);db.close();db=new ProjectDB(folder);expect(db.search('',{modelId:'siglip-test',vector:[.99,.01,0]})[0].id).toBe('mountain');expect(db.search('mountain',{modelId:'siglip-test',vector:[1,0,0]})[0].id).toBe('mountain');expect(db.search('',{modelId:'unknown',vector:[1,0,0]})).toEqual([]);}finally{db.close();}
});
