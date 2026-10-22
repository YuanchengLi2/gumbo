import {bracketClass} from '../shell/pattern';
import {CommandError} from '../shell/types';

/** POSIX basic (grep, sed) or extended (grep -E, sed -E, awk) regular expressions as JS RegExp source, with the GNU
 * extensions people use: \+ \? \| in basic, \< \> \b \w \s, and POSIX [[:classes:]]. */
export function posixRegex(pattern:string,extended:boolean):string{
 let out='',i=0;const n=pattern.length;
 const atStart=()=>out===''||/(\(|\||\(\?:)$/.test(out);
 while(i<n){
  const c=pattern[i];
  if(c==='['){
   let j=i+1;if(pattern[j]==='^'||pattern[j]==='!')j++;if(pattern[j]===']')j++;
   while(j<n&&pattern[j]!==']'){if(pattern[j]==='['&&/[:.=]/.test(pattern[j+1]??'')){const end=pattern.indexOf(pattern[j+1]+']',j+2);if(end>0){j=end+2;continue;}}j++;}
   if(j>=n)throw new CommandError(`unmatched [ in "${pattern}"`,2);
   out+=bracketClass(pattern.slice(i+1,j),true);i=j+1;continue;
  }
  if(c==='\\'){
   const d=pattern[i+1];i+=2;if(d===undefined){out+='\\\\';break;}
   if(!extended&&'(){}|+?'.includes(d)){out+=d;continue;}
   if(d==='<')out+='\\b(?=\\w)';else if(d==='>')out+='\\b(?<=\\w)';
   else if(d==='n')out+='\\n';else if(d==='t')out+='\\t';
   else if('bBwWsS123456789'.includes(d))out+='\\'+d;
   else if(d==='`')out+='^';else if(d==="'")out+='$';
   else out+=/[\\^$.*+?()[\]{}|/-]/.test(d)?'\\'+d:d;
   continue;
  }
  if(!extended&&'(){}|+?'.includes(c)){out+='\\'+c;i++;continue;}
  if(c==='*'&&atStart()){out+='\\*';i++;continue;}
  if(c==='^'&&!atStart()&&!extended){out+='\\^';i++;continue;}
  if(c==='$'&&!extended&&i<n-1&&!(pattern.startsWith('\\)',i+1)||pattern.startsWith('\\|',i+1))){out+='\\$';i++;continue;}
  if(extended&&c==='{'){const m=/^\{(\d*)(,?)(\d*)\}/.exec(pattern.slice(i));if(m&&(m[1]||m[3])){out+=`{${m[1]||'0'}${m[2]}${m[3]}}`;i+=m[0].length;continue;}out+='\\{';i++;continue;}
  if(extended&&c==='}'){out+='\\}';i++;continue;}
  if(c==='/'){out+='\\/';i++;continue;}
  out+=c;i++;
 }
 return out;
}
export function compileRegex(pattern:string,extended:boolean,flags=''):RegExp{
 try{return new RegExp(posixRegex(pattern,extended),flags);}
 catch(error){throw new CommandError(`invalid regular expression "${pattern}": ${(error as Error).message.replace(/^Invalid regular expression: /,'')}`,2);}
}
