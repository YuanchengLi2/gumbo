/** C printf formatting, shared by the printf command, awk's printf/sprintf, seq -f and stat -c widths. */
export type Arg=string|number|undefined;
const SPEC=/%([-+ #0']*)(\*|\d+)?(?:\.(\*|\d*))?(hh|h|ll|l|L|q|j|z|t)?([diouxXfFeEgGaAcsb%])/y;

/** A number from a printf argument the way C and the shell read it: 0x hex, 0 octal, 'c for a character code. */
export function numberArg(value:Arg,integer:boolean):{n:number;ok:boolean}{
 if(typeof value==='number')return{n:value,ok:true};if(value===undefined||value==='')return{n:0,ok:true};
 const s=value.trim();if(/^['"]/.test(s))return{n:s.codePointAt(1)??0,ok:true};
 if(integer){if(/^[-+]?0[xX][0-9a-fA-F]+$/.test(s))return{n:parseInt(s,16),ok:true};if(/^[-+]?0[0-7]+$/.test(s))return{n:parseInt(s,8),ok:true};}
 const n=Number(s);if(s!==''&&Number.isFinite(n))return{n,ok:true};
 const lead=/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?/.exec(s);return{n:lead?Number(lead[0]):0,ok:false};
}
function pad(body:string,width:number,left:boolean,zero:boolean,sign=''){
 const full=sign+body;if(full.length>=width)return full;
 if(left)return full.padEnd(width);if(zero)return sign+body.padStart(width-sign.length,'0');return full.padStart(width);
}
/** %g as C prints it: precision significant digits, trailing zeros dropped unless #. */
function general(n:number,precision:number,alternate:boolean,upper:boolean){
 const p=precision===0?1:precision;if(n===0)return alternate?(0).toFixed(p-1):'0';
let text:string;
 const rounded=Number(Math.abs(n).toPrecision(p)),e=rounded===0?0:Math.floor(Math.log10(rounded));
 if(e<-4||e>=p)text=exp(Math.abs(n),p-1);else text=Math.abs(n).toFixed(Math.max(0,p-1-e));
 if(!alternate)text=text.includes('e')?text.replace(/\.?0+e/,'e'):text.includes('.')?text.replace(/\.?0+$/,''):text;
return upper?text.toUpperCase():text;
}
/** toFixed with C's rounding: an exact tie (2.25 to one place) goes to the even digit, as glibc's printf does. */
const fixed=(n:number,p:number)=>{const s=n*10**p,f=Math.floor(s);if(s-f===0.5&&(f+0.5)/10**p===n)return((f%2===0?f:f+1)/10**p).toFixed(p);return n.toFixed(p);};
const exp=(n:number,digits:number)=>n.toExponential(digits).replace(/e([+-])(\d)$/,'e$10$2');
export function formatOne(spec:{flags:string;width?:number;precision?:number;conv:string},value:Arg,awk=false):{text:string;ok:boolean}{
 const {flags,conv}=spec,left=flags.includes('-'),zero=flags.includes('0')&&!left,plus=flags.includes('+'),space=flags.includes(' '),alt=flags.includes('#'),width=spec.width??0;
 const sign=(n:number)=>n<0?'-':plus?'+':space?' ':'';
 switch(conv){
  case's':{let s=value===undefined?'':typeof value==='number'?numberText(value):value;if(spec.precision!==undefined)s=s.slice(0,spec.precision);return{text:pad(s,width,left,false),ok:true};}
  case'c':{let s:string;if(typeof value==='number')s=String.fromCodePoint(Math.max(0,Math.trunc(Number(value))));else s=String(value??'').slice(0,1);return{text:pad(s,width,left,false),ok:true};}
  case'd':case'i':{const {n,ok}=numberArg(value,true),v=Math.trunc(n);let digits=String(Math.abs(v));if(spec.precision!==undefined)digits=spec.precision===0&&v===0?'':digits.padStart(spec.precision,'0');return{text:pad(digits,width,left,zero&&spec.precision===undefined,sign(v)),ok};}
  case'o':case'u':case'x':case'X':{
   const {n,ok}=numberArg(value,true);const v=BigInt.asUintN(64,BigInt(Math.trunc(n)));
   let digits=v.toString(conv==='o'?8:conv==='u'?10:16);if(conv==='X')digits=digits.toUpperCase();if(spec.precision!==undefined)digits=digits.padStart(spec.precision,'0');
   const prefix=alt&&v!==0n?conv==='o'?'0':conv==='x'?'0x':conv==='X'?'0X':'':'';return{text:pad(digits,width,left,zero&&spec.precision===undefined,prefix),ok};
  }
  case'f':case'F':case'e':case'E':case'g':case'G':case'a':case'A':{
   const {n,ok}=numberArg(value,false),p=spec.precision??6;let body:string;
   if(!Number.isFinite(n))body=Number.isNaN(n)?'nan':'inf';
   else if(conv==='f'||conv==='F')body=fixed(Math.abs(n),Math.min(p,100));
   else if(conv==='e'||conv==='E')body=exp(Math.abs(n),Math.min(p,100));
   else if(conv==='a'||conv==='A')body=Math.abs(n).toString(16);
   else body=general(n,p,alt,false);
   if(conv==='E'||conv==='G'||conv==='F'||conv==='A')body=body.toUpperCase();
   if(alt&&!body.includes('.')&&/^[\d]+$/.test(body))body+='.';
   return{text:pad(body,width,left,zero&&Number.isFinite(n),sign(n)),ok};
  }
 }
 return{text:'',ok:true};
}
/** Numbers as awk prints them in strings: integers plainly, others with %.6g. */
export function numberText(n:number){return Number.isInteger(n)&&Math.abs(n)<1e16?String(n):general(n,6,false,false);}
/** Expands one pass of a format over the arguments `next` yields. Returns the text and whether arguments were used,
 * so the shell's printf can reuse the format for the rest. */
export function format(fmt:string,next:()=>Arg,options:{awk?:boolean;escapes?:boolean;onBadNumber?:(value:string)=>void}={}):{text:string;used:number;stop:boolean}{
 let out='',used=0,i=0;const take=()=>{used++;return next();};
 while(i<fmt.length){
  const c=fmt[i];
  if(c==='\\'&&options.escapes){const r=escape(fmt,i);out+=r.text;i=r.end;if(r.stop)return{text:out,used,stop:true};continue;}
  if(c!=='%'){out+=c;i++;continue;}
  SPEC.lastIndex=i;const m=SPEC.exec(fmt);
  if(!m){out+='%';i++;continue;}
  i=SPEC.lastIndex;
  if(m[5]==='%'){out+='%';continue;}
  let flags=m[1].replace(/'/g,''),width:number|undefined,precision:number|undefined;
  if(m[2]==='*'){const w=Math.trunc(numberArg(take(),true).n);if(w<0){flags+='-';width=-w;}else width=w;}else if(m[2])width=Number(m[2]);
  if(m[3]!==undefined)precision=m[3]==='*'?Math.trunc(numberArg(take(),true).n):Number(m[3]||0);
  const value=take();
  if(m[5]==='b'){const r=escape(String(value??''),0,true);let s=r.text;if(precision!==undefined)s=s.slice(0,precision);out+=pad(s,width??0,flags.includes('-'),false);if(r.stop)return{text:out,used,stop:true};continue;}
  const r=formatOne({flags,width,precision,conv:m[5]},value,options.awk);if(!r.ok&&typeof value==='string')options.onBadNumber?.(value);out+=r.text;
 }
 return{text:out,used,stop:false};
}
/** One backslash escape at `at`; %b also takes \0NNN octal and \c to stop all output. */
export function escape(text:string,at:number,b=false):{text:string;end:number;stop:boolean}{
 if(text[at]!=='\\'){if(!b)return{text:text[at],end:at+1,stop:false};let out='',i=at;while(i<text.length){if(text[i]==='\\'){const r=escape(text,i,true);out+=r.text;i=r.end;if(r.stop)return{text:out,end:i,stop:true};}else out+=text[i++];}return{text:out,end:i,stop:false};}
 const c=text[at+1];const simple:Record<string,string>={n:'\n',t:'\t',r:'\r','\\':'\\',a:'\x07',b:'\b',f:'\f',v:'\v',e:'\x1b','"':'"',"'":"'"};
 if(c===undefined)return{text:'\\',end:at+1,stop:false};
 if(c in simple)return{text:simple[c],end:at+2,stop:false};
 if(c==='c')return{text:'',end:text.length,stop:true};
 if(c==='x'){const m=/^[0-9a-fA-F]{1,2}/.exec(text.slice(at+2))?.[0];return m?{text:String.fromCharCode(parseInt(m,16)),end:at+2+m.length,stop:false}:{text:'\\x',end:at+2,stop:false};}
 if(c==='u'||c==='U'){const m=new RegExp(`^[0-9a-fA-F]{1,${c==='u'?4:8}}`).exec(text.slice(at+2))?.[0];return m?{text:String.fromCodePoint(parseInt(m,16)),end:at+2+m.length,stop:false}:{text:'\\'+c,end:at+2,stop:false};}
 if(/[0-7]/.test(c)){const m=/^[0-7]{1,3}/.exec(text.slice(at+(b&&c==='0'?2:1)))?.[0]??'';return{text:String.fromCharCode(parseInt(m||'0',8)&255),end:at+(b&&c==='0'?2:1)+m.length,stop:false};}
 return{text:'\\'+c,end:at+2,stop:false};
}
