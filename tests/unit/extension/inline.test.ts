import {it,expect,describe} from 'vitest';
import {actionOf} from '../../../apps/extension/src/background/inline-action';
import {markdownToHtml,plainOf,hasFormatting} from '../../../apps/extension/src/shared/richtext';

describe('Ctrl+K',()=>{
 it('turns the model\'s action into a link that does it',()=>{
  const event=actionOf('{"do":"calendar","title":"Design review","start":"2026-11-05T15:00","location":"Lisbon room"}')!;
  const url=new URL(event.url!);
  expect(url.origin+url.pathname).toBe('https://calendar.google.com/calendar/render');
  expect(url.searchParams.get('text')).toBe('Design review');expect(url.searchParams.get('dates')).toBe('20261105T150000/20261105T160000');
  expect(actionOf('{"do":"search","where":"mail","query":"from:priya"}')!.url).toBe('https://mail.google.com/mail/u/0/#search/from%3Apriya');
  expect(actionOf('{"do":"search","where":"maps","query":"Tartine SF"}')!.url).toContain('google.com/maps/search/?api=1&query=Tartine%20SF');
  expect(actionOf('{"do":"note","text":"Call the bank"}')).toMatchObject({do:'note',text:'Call the bank'});
  expect(actionOf('{"do":"open","url":"javascript:alert(1)"}')).toBeUndefined();
  expect(actionOf('not json')).toBeUndefined();
 });
 it('keeps formatting through Markdown and back',()=>{
  expect(markdownToHtml('Ship the **beta** on *Friday*, see [the plan](https://example.com).')).toBe('<p>Ship the <strong>beta</strong> on <em>Friday</em>, see <a href="https://example.com">the plan</a>.</p>');
  expect(markdownToHtml('- one\n- two')).toBe('<ul><li>one</li><li>two</li></ul>');
  expect(markdownToHtml('<script>x</script>')).toBe('<p>&lt;script&gt;x&lt;/script&gt;</p>');
  expect(plainOf('Ship the **beta** on *Friday*, see [the plan](https://example.com).')).toBe('Ship the beta on Friday, see the plan.');
  expect(hasFormatting('plain text, nothing else')).toBe(false);expect(hasFormatting('a **bold** word')).toBe(true);
 });
});
