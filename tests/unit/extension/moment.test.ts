import {describe,expect,it} from 'vitest';
import {momentUrl,momentOf,clock} from '../../../apps/extension/src/shared/moment';

describe('links to a moment',()=>{
 it('uses YouTube’s own t= on a watch page and on youtu.be',()=>{
  expect(momentUrl('https://www.youtube.com/watch?v=abc123&list=x',95.7)).toBe('https://www.youtube.com/watch?v=abc123&list=x&t=95s');
  expect(momentUrl('https://www.youtube.com/watch?v=abc123&t=10s',42)).toBe('https://www.youtube.com/watch?v=abc123&t=42s');
  expect(momentUrl('https://youtu.be/abc123',3)).toBe('https://youtu.be/abc123?t=3s');
 });
 it('uses #gumbo-t= elsewhere, and replaces an earlier one',()=>{
  expect(momentUrl('https://example.com/talk',61)).toBe('https://example.com/talk#gumbo-t=61');
  expect(momentUrl('https://example.com/talk#gumbo-t=5',61)).toBe('https://example.com/talk#gumbo-t=61');
 });
 it('leaves a page that routes by its hash as it is',()=>{
  expect(momentUrl('https://app.example.com/#/recordings/7',30)).toBe('https://app.example.com/#/recordings/7');
  expect(momentUrl('not a url',30)).toBe('not a url');
 });
 it('reads the moment back and writes times like a player',()=>{
  expect(momentOf('#gumbo-t=61')).toBe(61);expect(momentOf('#/x')).toBeUndefined();
  expect(clock(0)).toBe('0:00');expect(clock(75)).toBe('1:15');expect(clock(3725)).toBe('1:02:05');
 });
});
