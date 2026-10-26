import {describe,expect,it} from 'vitest';
import {shortUrl,searchOf} from '../../../apps/extension/src/shared/address';

describe('addresses as the agent reads them',()=>{
 it('reads the search someone ran, on any site',()=>{
  expect(searchOf('https://www.google.com/search?q=cheap+flights+to+denver&hl=en')).toBe('cheap flights to denver');
  expect(searchOf('https://www.youtube.com/results?search_query=lofi')).toBe('lofi');
  expect(searchOf('https://www.amazon.com/s?k=usb+c+hub')).toBe('usb c hub');
  expect(searchOf('https://github.com/microsoft/vscode')).toBeUndefined();
 });
 it('keeps an address short: the site and the start of the path',()=>{
  expect(shortUrl('https://docs.google.com/document/d/abc/edit')).toBe('docs.google.com/document/d/abc/edit');
  expect(shortUrl('https://news.ycombinator.com/')).toBe('news.ycombinator.com');
  expect(shortUrl('not a url')).toBe('not a url');
 });
});
