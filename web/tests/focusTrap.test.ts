import { describe, expect, it } from 'vitest';
import { wrapFocus } from '../src/ui/focusTrap';

describe('wrapFocus', () => {
  const list = ['a', 'b', 'c'];
  it('wraps forward from the last control to the first', () => expect(wrapFocus(list, 'c', false)).toBe('a'));
  it('wraps back from the first control to the last', () => expect(wrapFocus(list, 'a', true)).toBe('c'));
  it('leaves moves inside the list to the browser', () => {
    expect(wrapFocus(list, 'b', false)).toBeNull();
    expect(wrapFocus(list, 'b', true)).toBeNull();
  });
  it('pulls focus in from outside the dialog', () => {
    expect(wrapFocus(list, 'z', false)).toBe('a');
    expect(wrapFocus(list, null, true)).toBe('c');
  });
  it('does nothing with no controls', () => expect(wrapFocus([], 'a', false)).toBeNull());
});
