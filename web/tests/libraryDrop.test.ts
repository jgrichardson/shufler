import { describe, expect, it } from 'vitest';
import { dropDomain } from '../src/ui/library/drag';
import { FALLBACK } from '../src/lib/domains';
import { parsePrefs } from '../src/ui/prefs';

describe('drop: session or its whole domain', () => {
  const stations = [
    { id: 'a', domain: 'platform' },
    { id: 'b', domain: FALLBACK },
  ];
  it('offers the domain of a session that has one', () => expect(dropDomain('a', stations, FALLBACK)).toBe('platform'));
  it('sends straight to unassigned and unknown sessions', () => {
    expect(dropDomain('b', stations, FALLBACK)).toBeNull();
    expect(dropDomain('utility-x', stations, FALLBACK)).toBeNull();
  });
});

describe('red arcs pref', () => {
  it('defaults to hover or select only', () => expect(parsePrefs(null).redArcsAlways).toBe(false));
  it('keeps a stored choice and drops junk', () => {
    expect(parsePrefs({ redArcsAlways: true }).redArcsAlways).toBe(true);
    expect(parsePrefs({ redArcsAlways: 'yes' }).redArcsAlways).toBe(false);
  });
});
