import type {ProjectDB} from '@dream/project-db';
import {z} from 'zod';
export const DecisionInput=z.object({sourceId:z.string().optional(),scope:z.string().min(1).max(200),text:z.string().min(1).max(4000),supersedes:z.string().optional()});
// Quotes are compared without regard to quote marks, dashes or spacing, which models often normalize.
const plain=(text:string)=>text.replace(/[\u2018\u2019\u201b']/g,"'").replace(/[\u201c\u201d"]/g,'"').replace(/[\u2013\u2014]/g,'-').replace(/\s+/g,' ').trim().toLowerCase();
/** Only verbatim user direction can become an authoritative project decision. The quote finds its message: the given ID
 * (a message ID or a conversation record ID such as conversation:<id>:0), else the latest user message that contains it. */
// Users type fast and models fix the spelling when they quote, so a quote also matches a message that holds nearly all of
// its words, each the same or one or two letters off. Words that are not the user's still never become a decision.
const words=(text:string)=>plain(text).replace(/[^a-z0-9' ]+/g,' ').split(' ').filter(Boolean).map(w=>w.replace(/(?:'s|s)$/,''));
// Edit distance with swapped neighbours as one typo ("teh", "amke").
const near=(a:string,b:string)=>{if(a===b)return true;if(Math.min(a.length,b.length)<3||Math.abs(a.length-b.length)>2)return false;
 const d=Array.from({length:a.length+1},(_,i)=>Array.from({length:b.length+1},(_,j)=>i===0?j:j===0?i:0));
 for(let i=1;i<=a.length;i++)for(let j=1;j<=b.length;j++){d[i][j]=Math.min(d[i-1][j]+1,d[i][j-1]+1,d[i-1][j-1]+(a[i-1]===b[j-1]?0:1));if(i>1&&j>1&&a[i-1]===b[j-2]&&a[i-2]===b[j-1])d[i][j]=Math.min(d[i][j],d[i-2][j-2]+1);}
 return d[a.length][b.length]<=(Math.max(a.length,b.length)>=7?2:1);};
const quotes=(message:string,text:string)=>{if(plain(message).includes(plain(text)))return true;const q=words(text),m=words(message);return q.length>=2&&q.filter(w=>m.some(x=>near(w,x))).length>=Math.ceil(q.length*.8);};
export function rememberDecision(db:ProjectDB,input:unknown){const parsed=DecisionInput.parse(input),id=parsed.sourceId?.replace(/^conversation:([^:]+):\d+$/,'$1');
 const named=id?db.db.prepare("SELECT id,text FROM messages WHERE id=? AND role='user'").get(id) as {id:string;text:string}|undefined:undefined;
 const source=named&&quotes(named.text,parsed.text)?named:(db.db.prepare("SELECT id,text FROM messages WHERE role='user' ORDER BY rowid DESC LIMIT 50").all() as {id:string;text:string}[]).find(m=>quotes(m.text,parsed.text));
 if(!source)throw new Error('A project decision must quote the user\'s own words; this text is not in any of their recent messages.');const a={...parsed,sourceId:source.id};return db.db.transaction(()=>{if(a.supersedes){const old=db.db.prepare('SELECT scope FROM project_decisions WHERE id=?').get(a.supersedes) as {scope:string}|undefined;if(!old||old.scope!==a.scope)throw new Error('The superseded decision must have the same scope.');db.db.prepare('UPDATE project_decisions SET active=0 WHERE id=?').run(a.supersedes);}const id=db.blobs.putJSON(a);db.db.prepare('INSERT OR IGNORE INTO project_decisions(id,source_id,scope,text,supersedes) VALUES(?,?,?,?,?)').run(id,a.sourceId,a.scope,a.text,a.supersedes??null);return{id,...a};})();}
export function activeDecisions(db:ProjectDB){const items=db.db.prepare('SELECT id,source_id AS sourceId,scope,text FROM project_decisions WHERE active=1 ORDER BY rowid DESC LIMIT 20').all(),total=(db.db.prepare('SELECT COUNT(*) AS n FROM project_decisions WHERE active=1').get() as {n:number}).n;return{items,total,partial:total>items.length,read:'Search project kind decision for additional applicable rules.'};}
