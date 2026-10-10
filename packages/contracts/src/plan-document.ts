import {validateTaskPlan,type TaskPlan} from './workflow';

export function planDocument(plan:TaskPlan){
 return `# ${plan.title}\n\n## Goal\n${plan.goal}\n\n## Steps\n\n${plan.steps.map(step=>`### ${step.title}\n${step.instruction}\n\n#### Done when\n${step.acceptance}`).join('\n\n')}\n\n## Assumptions\n${plan.assumptions.map(value=>'- '+value).join('\n')}\n`;
}
export function parsePlanDocument(document:string,previous?:TaskPlan):TaskPlan {
 const text=document.replace(/\r\n/g,'\n').trim();
 const match=/^# ([^\n]+)\n+## Goal\n([\s\S]+?)\n## Steps\n([\s\S]+?)\n## Assumptions(?:\n([\s\S]*))?$/.exec(text);
 if(!match)throw new Error('Keep a title and the Goal, Steps, and Assumptions headings.');
 const [,title,goal,body,assumptions='']=match,used=new Set<string>();
 const parts=body.trim().split(/\n(?=### )/);
 const steps=parts.map((part,index)=>{
  const step=/^### ([^\n]+)\n([\s\S]+?)\n#### Done when\n([\s\S]+)$/.exec(part.trim());
  if(!step)throw new Error(`Step ${index+1} needs a heading, instructions, and a Done when section.`);
  const old=previous?.steps.find(item=>(item.title===step[1].trim()||item.instruction===step[2].trim()&&item.acceptance===step[3].trim())&&!used.has(item.id));if(old)used.add(old.id);
  return{id:old?.id??crypto.randomUUID(),title:step[1].trim(),instruction:step[2].trim(),acceptance:step[3].trim(),review:old?.review??true};
 });
 const items=assumptions.trim()?assumptions.trim().split('\n').map(line=>{if(!/^[-*] /.test(line))throw new Error('Write each assumption as a bullet beginning with - .');return line.slice(2).trim();}):[];
 return validateTaskPlan({schemaVersion:1,title:title.trim(),goal:goal.trim(),steps,assumptions:items});
}
