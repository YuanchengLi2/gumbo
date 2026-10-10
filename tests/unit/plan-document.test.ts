import {it,expect} from 'vitest';
import {planDocument,parsePlanDocument,TaskPlanSchema} from '@dream/contracts';
const plan=TaskPlanSchema.parse({schemaVersion:1,title:'A short story',goal:'Keep the speaker’s meaning.',steps:[{id:'cut',title:'Tighten pauses',instruction:'Remove long pauses.\nPreserve all dialogue.',acceptance:'All sentences remain.',review:false}],assumptions:['Keep original audio.']});
it('round-trips full plans and supports adding and reordering steps without an AI request',()=>{
 expect(parsePlanDocument(planDocument(plan),plan)).toEqual(plan);expect(parsePlanDocument(planDocument(plan).replace('### Tighten pauses','### Keep the pacing natural'),plan).steps[0]).toMatchObject({id:'cut',review:false});
 const changed=planDocument(plan).replace('## Assumptions','### Add a title\nUse the project name.\n\n#### Done when\nThe opening title is legible.\n\n## Assumptions');
 const parsed=parsePlanDocument(changed,plan);expect(parsed.steps[0].id).toBe('cut');expect(parsed.steps[1].review).toBe(true);expect(parsed.steps[1].id).not.toBe('cut');
 expect(()=>parsePlanDocument(changed.replaceAll('#### Done when','#### Other'),plan)).toThrow('Done when');
});
