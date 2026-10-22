/** Shell arithmetic ($(( )), (( )), let, for ((;;))): C integer operators, assignments and variables by name. */
type Vars={get(name:string):string|undefined;set(name:string,value:string):void};
type Ast=
 |{k:'num';v:number}|{k:'var';name:string}
 |{k:'un';op:string;a:Ast}|{k:'bin';op:string;a:Ast;b:Ast}
 |{k:'tern';c:Ast;a:Ast;b:Ast}|{k:'assign';op:string;name:string;b:Ast}
 |{k:'inc';name:string;delta:number;post:boolean}|{k:'comma';a:Ast;b:Ast};
const BINARY:[string[],number][]=[[['||'],1],[['&&'],2],[['|'],3],[['^'],4],[['&'],5],[['==','!='],6],[['<=','>=','<','>'],7],[['<<','>>'],8],[['+','-'],9],[['*','/','%'],10]];
const TOKEN=/\s*(0[xX][0-9a-fA-F]+|\d+#[0-9a-zA-Z@_]+|\d+|[A-Za-z_][A-Za-z0-9_]*|\*\*=?|<<=|>>=|\+\+|--|&&|\|\||==|!=|<=|>=|<<|>>|[-+*/%&^|]=|[-+*/%<>&^|!~?:=(),])/y;
export class ArithError extends Error{}
export function arithmetic(source:string,vars:Vars,depth=0):number{
 if(depth>32)throw new ArithError('expression recursion level exceeded');
 const tokens:string[]=[];TOKEN.lastIndex=0;let m:RegExpExecArray|null;const s=source.trim();
 while(TOKEN.lastIndex<s.length&&(m=TOKEN.exec(s)))tokens.push(m[1]);
 if(TOKEN.lastIndex<s.length&&s.slice(TOKEN.lastIndex).trim())throw new ArithError(`syntax error in expression (error token is "${s.slice(TOKEN.lastIndex).trim()}")`);
 if(!tokens.length)return 0;
 let i=0;const peek=()=>tokens[i],next=()=>tokens[i++];
 const expect=(t:string)=>{if(next()!==t)throw new ArithError(`syntax error: expected "${t}"`);};
 const comma=():Ast=>{let a=assign();while(peek()===','){i++;a={k:'comma',a,b:assign()};}return a;};
 const assign=():Ast=>{
  const t=peek(),op=tokens[i+1];
  if(t&&/^[A-Za-z_]/.test(t)&&op&&/^(=|\+=|-=|\*=|\/=|%=|<<=|>>=|&=|\^=|\|=|\*\*=)$/.test(op)){i+=2;return{k:'assign',op,name:t,b:assign()};}
  const c=binary(0);if(peek()==='?'){i++;const a=assign();expect(':');return{k:'tern',c,a,b:assign()};}return c;
 };
 const binary=(level:number):Ast=>{
  if(level>=BINARY.length)return power();
  let a=binary(level+1);while(BINARY[level][0].includes(peek())){const op=next();a={k:'bin',op,a,b:binary(level+1)};}return a;
 };
 const power=():Ast=>{const a=unary();if(peek()==='**'){i++;return{k:'bin',op:'**',a,b:power()};}return a;};
 const unary=():Ast=>{
  const t=peek();
  if(t==='++'||t==='--'){i++;const name=next();if(!name||!/^[A-Za-z_]/.test(name))throw new ArithError('syntax error: ++/-- needs a variable');return{k:'inc',name,delta:t==='++'?1:-1,post:false};}
  if(t==='-'||t==='+'||t==='!'||t==='~'){i++;return{k:'un',op:t,a:unary()};}
  return postfix();
 };
 const postfix=():Ast=>{const a=primary();if(a.k==='var'&&(peek()==='++'||peek()==='--')){const op=next();return{k:'inc',name:a.name,delta:op==='++'?1:-1,post:true};}return a;};
 const primary=():Ast=>{
  const t=next();if(t===undefined)throw new ArithError('syntax error: operand expected');
  if(t==='('){const a=comma();expect(')');return a;}
  if(/^\d+#/.test(t)){const [base,digits]=t.split('#');return{k:'num',v:parseInt(digits,Number(base))};}
  if(/^0[xX]/.test(t))return{k:'num',v:parseInt(t,16)};
  if(/^0\d+$/.test(t))return{k:'num',v:parseInt(t,8)};
  if(/^\d/.test(t))return{k:'num',v:Number(t)};
  if(/^[A-Za-z_]/.test(t))return{k:'var',name:t};
  throw new ArithError(`syntax error: operand expected (error token is "${t}")`);
 };
 const ast=comma();if(i<tokens.length)throw new ArithError(`syntax error in expression (error token is "${tokens.slice(i).join(' ')}")`);
 const read=(name:string)=>{const v=vars.get(name);if(v===undefined||v.trim()==='')return 0;const n=Number(v.trim());return Number.isFinite(n)&&/^\s*-?\d/.test(v)?Math.trunc(n):arithmetic(v,vars,depth+1);};
 const int=(n:number)=>{if(!Number.isFinite(n))throw new ArithError('division by 0');return Math.trunc(n);};
 const apply=(op:string,a:number,b:number):number=>{
  switch(op){
   case'+':return a+b;case'-':return a-b;case'*':return a*b;
   case'/':if(b===0)throw new ArithError('division by 0');return Math.trunc(a/b);
   case'%':if(b===0)throw new ArithError('division by 0');return a%b;
   case'**':if(b<0)throw new ArithError('exponent less than 0');return a**b;
   case'<<':return a<<b;case'>>':return a>>b;case'&':return a&b;case'|':return a|b;case'^':return a^b;
   case'==':return+(a===b);case'!=':return+(a!==b);case'<':return+(a<b);case'>':return+(a>b);case'<=':return+(a<=b);case'>=':return+(a>=b);
  }
  throw new ArithError('unknown operator '+op);
 };
 const evaluate=(n:Ast):number=>{
  switch(n.k){
   case'num':return n.v;case'var':return read(n.name);
   case'un':{const a=evaluate(n.a);return n.op==='-'?-a:n.op==='+'?a:n.op==='!'?+(a===0):~a;}
   case'bin':{if(n.op==='&&')return+(evaluate(n.a)!==0&&evaluate(n.b)!==0);if(n.op==='||')return+(evaluate(n.a)!==0||evaluate(n.b)!==0);return int(apply(n.op,evaluate(n.a),evaluate(n.b)));}
   case'tern':return evaluate(n.c)!==0?evaluate(n.a):evaluate(n.b);
   case'comma':evaluate(n.a);return evaluate(n.b);
   case'assign':{const b=evaluate(n.b),v=n.op==='='?b:int(apply(n.op.slice(0,-1),read(n.name),b));vars.set(n.name,String(v));return v;}
   case'inc':{const old=read(n.name),v=old+n.delta;vars.set(n.name,String(v));return n.post?old:v;}
  }
 };
 return evaluate(ast);
}
