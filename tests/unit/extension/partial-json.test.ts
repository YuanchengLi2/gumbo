import {describe,expect,it} from 'vitest';
import {partialJson} from '../../../apps/extension/src/shared/partial-json';

describe('tool arguments as they stream',()=>{
 it('reads what has arrived of a string, a number and nested objects',()=>{
  expect(partialJson('{"url":"https://exa')).toEqual({url:'https://exa'});
  expect(partialJson('{"by":-40')).toEqual({by:-40});
  expect(partialJson('{"target":{"role":"button","name":"Se')).toEqual({target:{role:'button',name:'Se'}});
  expect(partialJson('{"items":[{"text":"Find flights","done":true},{"text":"Book')).toEqual({items:[{text:'Find flights',done:true},{text:'Book'}]});
 });
 it('drops a key that has no value yet, and a dangling escape',()=>{
  expect(partialJson('{"text":"hi","replace')).toEqual({text:'hi'});
  expect(partialJson('{"text":"hi","replace":')).toEqual({text:'hi'});
  expect(partialJson('{"text":"a\\')).toEqual({text:'a'});
 });
 it('gives whole JSON as it is, and nothing for nothing',()=>{
  expect(partialJson('{"a":1}')).toEqual({a:1});
  expect(partialJson('')).toBeUndefined();
 });
});
