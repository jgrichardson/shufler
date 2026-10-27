import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getStored, storageKey } from '../src/lib/storage';

function fakeStorage(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return {
    m,
    get length() {
      return m.size;
    },
    key: (i: number) => [...m.keys()][i] ?? null,
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
  };
}

describe('storage keys', () => {
  let ls: ReturnType<typeof fakeStorage>;
  beforeEach(() => {
    ls = fakeStorage();
    vi.stubGlobal('localStorage', ls);
  });
  afterEach(() => vi.unstubAllGlobals());

  it('prefixes every key with the product slug', () => {
    expect(storageKey('prefs')).toBe('shufler.prefs');
    expect(storageKey('commands.history.tests')).toBe('shufler.commands.history.tests');
  });

  it('reads the key, or null when missing', () => {
    expect(getStored(storageKey('tickerOpen'))).toBeNull();
    ls.m.set(storageKey('tickerOpen'), '1');
    expect(getStored(storageKey('tickerOpen'))).toBe('1');
  });
});

