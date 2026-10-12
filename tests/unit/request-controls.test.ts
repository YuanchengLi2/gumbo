import {describe,it,expect} from 'vitest';
import {parseCodeRoute} from '../../packages/orchestrator/src/code-director';
import {routeCodeRequest} from '../../packages/orchestrator/src/routing';
import {intelligence} from '../../packages/orchestrator/src/intelligence';

describe('composer permission and effort',()=>{
 it('ask only answers without changing the project, whatever the request says',()=>{
  expect(routeCodeRequest('Make the intro faster and add music','ask').route).toBe('question');
  expect(parseCodeRoute({route:'local',intelligence:'opus',complexity:'difficult',reason:'build'},'Make the intro faster','ask').route).toBe('question');
  expect(parseCodeRoute({route:'continue',intelligence:'haiku',complexity:'normal'},'continue','ask',true).route).toBe('question');
  expect(routeCodeRequest('continue','ask',true).route).toBe('question');
 });
 it('plan first and edit automatically keep their routes',()=>{
  expect(parseCodeRoute({route:'local',intelligence:'opus',complexity:'difficult'},'Make a trailer','plan').route).toBe('plan');
  expect(parseCodeRoute({route:'local',intelligence:'haiku',complexity:'simple'},'Mute clip 2','auto').route).toBe('local');
 });
 it('a chosen effort applies to every model except the router',()=>{
  expect(intelligence('opus','execution',{complexity:'difficult'},0,'low').effort).toBe('low');
  expect(intelligence('haiku','execution',{complexity:'simple'},0,'high').effort).toBe('high');
  expect(intelligence('haiku','worker',undefined,0,'medium').effort).toBe('medium');
  expect(intelligence('haiku','routing',undefined,0,'high').effort).toBe('low');
  expect(intelligence('opus','execution',{complexity:'normal'},0,'').effort).toBe('medium');
  expect(intelligence('haiku','execution',{complexity:'difficult'}).effort).toBe('high');
 });
});
