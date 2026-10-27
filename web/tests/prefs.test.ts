import { describe, expect, it } from 'vitest';
import { DEFAULT_PREFS, parsePrefs } from '../src/ui/prefs';
import { initialState, reduce } from '../src/store/reducer';

describe('viewer prefs', () => {
  it('defaults: dark chrome, follow the terminal by selecting, grey out the rest, keep the camera still, no context auto-send', () => {
    expect(parsePrefs(null)).toEqual({ theme: 'dark', terminalFollow: 'select', followPauseSec: 20, selectDims: true, flyOnSelect: false, redArcsAlways: false, autoSendPinned: false });
  });

  it('drops malformed values instead of breaking', () => {
    expect(parsePrefs({ terminalFollow: 'chase', followPauseSec: -4, selectDims: 'yes', flyOnSelect: 1 })).toEqual(DEFAULT_PREFS);
  });
});

describe('fly on select', () => {
  const pick = (id: string) => ({ type: 'select' as const, selection: { kind: 'station' as const, id } });

  it('off: selecting keeps the camera still', () => {
    expect(reduce(initialState, pick('a')).flySeq).toBe(initialState.flySeq);
  });

  it('on: a new selection flies, re-selecting the same thing or fly: false does not', () => {
    let s = reduce(initialState, { type: 'prefs', flyOnSelect: true });
    s = reduce(s, pick('a'));
    expect(s.flySeq).toBe(1);
    s = reduce(s, pick('a'));
    expect(s.flySeq).toBe(1);
    s = reduce(s, { ...pick('b'), fly: false });
    expect(s.flySeq).toBe(1);
  });
});
