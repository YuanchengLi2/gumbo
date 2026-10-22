/** POSIX paths for the sandbox's own namespace: the shell, tools and programs all see one tree rooted at "/". */
export function normalize(path:string){
 const absolute=path.startsWith('/'),parts:string[]=[];
 for(const part of path.split('/')){if(!part||part==='.')continue;if(part==='..'){if(parts.length&&parts[parts.length-1]!=='..')parts.pop();else if(!absolute)parts.push('..');continue;}parts.push(part);}
 const joined=parts.join('/');return absolute?'/'+joined:joined||'.';
}
export const join=(...parts:string[])=>normalize(parts.filter(Boolean).join('/'));
export const resolve=(cwd:string,path:string)=>normalize(path.startsWith('/')?path:cwd+'/'+path);
export function dirname(path:string){const p=normalize(path);if(p==='/')return'/';const i=p.lastIndexOf('/');return i<0?'.':i===0?'/':p.slice(0,i);}
export function basename(path:string,suffix?:string){const p=path.replace(/\/+$/,'')||'/';if(p==='/')return'/';const base=p.slice(p.lastIndexOf('/')+1);return suffix&&base!==suffix&&base.endsWith(suffix)?base.slice(0,-suffix.length):base;}
export function extname(path:string){const base=basename(path),i=base.lastIndexOf('.');return i<=0?'':base.slice(i);}
export function relative(from:string,to:string){
 const a=normalize(from).split('/').filter(Boolean),b=normalize(to).split('/').filter(Boolean);let i=0;while(i<a.length&&i<b.length&&a[i]===b[i])i++;
 return[...Array(a.length-i).fill('..'),...b.slice(i)].join('/')||'.';
}
export const isAbsolute=(path:string)=>path.startsWith('/');
