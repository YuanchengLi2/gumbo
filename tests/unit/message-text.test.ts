import {describe,it,expect} from 'vitest';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {MessageText} from '../../apps/desktop/src/renderer/components/chat/MessageText';

const html=(text:string,streaming=false)=>renderToStaticMarkup(React.createElement(MessageText,{text,streaming}));

describe('chat markdown',()=>{
 it('renders a script answer with a table, emphasis and lists',()=>{
  const out=html(['**CLAUDE, EXPLAINED IN MINECRAFT** — 22-second script','','| Time | Visual | Voiceover |','|:---|---|---:|','| 0–3s | Steve mines a *glowing* block | “What if your pickaxe could **think**?” |','| 3–8s | Blocks assemble `claude` | Meet Claude |','','### Notes','- Keep it *punchy*','  - nested beat','1. First','2. Second','','> Quote line','','---'].join('\n'));
  expect(out).toContain('<strong>CLAUDE, EXPLAINED IN MINECRAFT</strong>');
  expect(out).toContain('<table>');expect(out).toContain('<th style="text-align:left">Time</th>');expect(out).toContain('<td style="text-align:right">');
  expect(out).toContain('<em>glowing</em>');expect(out).toContain('<strong>think</strong>');expect(out).toContain('<code>claude</code>');
  expect(out).toContain('<h4 class="md-h3">Notes</h4>');expect(out).toMatch(/<ul><li>Keep it <em>punchy<\/em><ul><li>nested beat<\/li><\/ul><\/li><\/ul>/);
  expect(out).toContain('<ol><li>First</li><li>Second</li></ol>');expect(out).toContain('<blockquote><p>Quote line</p></blockquote>');expect(out).toContain('<hr/>');
  expect(out).not.toContain('|');expect(out).not.toContain('**');
 });
 it('keeps snake_case, code and unfinished markup literal',()=>{
  const out=html('Use file_name_here and `a*b*c` and an **unfinished');
  expect(out).toContain('file_name_here');expect(out).toContain('<code>a*b*c</code>');expect(out).toContain('**unfinished');expect(out).not.toContain('<em>');
 });
 it('renders a code fence and a cursor while streaming',()=>{
  const out=html('Here:\n```js\nconst a = 1;\n```\nDone',true);
  expect(out).toContain('<pre data-lang="js"><code>const a = 1;</code></pre>');expect(out).toMatch(/<p>Done<span class="stream-cursor"/);
  expect(html('```\npartial',true)).toContain('<code>partial<span class="stream-cursor"');
 });
 it('joins soft line breaks without blank gaps',()=>{
  expect(html('\n\nFirst line\nsecond line\n\n\nNext paragraph\n')).toBe('<div class="message-prose"><p>First line<br/>second line</p><p>Next paragraph</p></div>');
 });
});
