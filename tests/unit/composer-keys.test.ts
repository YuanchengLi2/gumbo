import {describe,expect,it} from 'vitest';
import {keyOwner} from '../../apps/desktop/src/renderer/manual/shortcuts';
import {stopGuard,STOP_GRACE_MS} from '../../apps/desktop/src/renderer/components/chat/stop-guard';

describe('keys typed in a text field never act as shortcuts',()=>{
 const box={name:'chat box'},button={name:'button'};
 it('a key with focus on nothing still belongs to the field focus vanished from',()=>{
  const owner=keyOwner<object>();owner.focusIn(box,true);
  // The box is removed mid-sentence: no blur comes, focus is on nothing.
  expect(owner.orphan(true)).toBe(box);
  // While focus is in the field itself, the key is its own (the target says so), not an orphan.
  expect(owner.orphan(false)).toBeNull();
 });
 it('focus the user really moved frees the keys again',()=>{
  const blurred=keyOwner<object>();blurred.focusIn(box,true);blurred.focusOut(box);expect(blurred.orphan(true)).toBeNull();
  const clicked=keyOwner<object>();clicked.focusIn(box,true);clicked.pressed();expect(clicked.orphan(true)).toBeNull();
  const tabbed=keyOwner<object>();tabbed.focusIn(box,true);tabbed.focusIn(button,false);expect(tabbed.orphan(true)).toBeNull();
 });
 it('a blur from another element does not free a field that still has focus',()=>{
  const owner=keyOwner<object>();owner.focusIn(box,true);owner.focusOut(button);expect(owner.orphan(true)).toBe(box);
 });
});

describe('a quick second click after sending does not stop the request',()=>{
 it('ignores Stop clicks for a moment after it replaces Send, then stops at once',()=>{
  let now=1000;const guard=stopGuard(()=>now);
  guard.shown();now+=120;expect(guard.allows()).toBe(false);
  now+=STOP_GRACE_MS-121;expect(guard.allows()).toBe(false);
  now+=1;expect(guard.allows()).toBe(true);
 });
 it('covers a slow double click (the system double-click time)',()=>{
  let now=0;const guard=stopGuard(()=>now);guard.shown();now=450;expect(guard.allows()).toBe(false);
 });
 it('stops at once when Stop was never just shown',()=>{
  expect(stopGuard(()=>5).allows()).toBe(true);
 });
});
