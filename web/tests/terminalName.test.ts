import { describe, expect, it } from 'vitest';
import { focusLabel, newTabLabel, terminalName, unsentText } from '../src/lib/terminalName';

describe('terminalName', () => {
  it('maps the snapshot terminal kind to its display name', () => {
    expect(terminalName('cmux')).toBe('cmux');
    expect(terminalName('iterm2')).toBe('iTerm2');
    expect(terminalName('tmux')).toBe('tmux');
  });

  it('says "terminal" when the kind is missing or unknown', () => {
    expect(terminalName(undefined)).toBe('terminal');
    expect(terminalName(null)).toBe('terminal');
    expect(terminalName('')).toBe('terminal');
    expect(terminalName('wezterm')).toBe('terminal');
  });

  it('words the levers and the refusal for that terminal', () => {
    expect(focusLabel(terminalName('iterm2'))).toBe('Focus in iTerm2');
    expect(newTabLabel(terminalName('tmux'))).toBe('New tmux tab here');
    expect(newTabLabel(terminalName(null))).toBe('New terminal tab here');
    expect(unsentText('cmux')).toBe('that session has unsent text in its input; finish or clear it in cmux first');
  });
});
