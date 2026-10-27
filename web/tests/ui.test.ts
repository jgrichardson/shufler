import { describe, expect, it } from 'vitest';
import { fuzzy } from '../src/ui/skills';
import { shouldFollow } from '../src/ui/followCmux';

describe('fuzzy', () => {
  it('ranks a substring match above a scattered match', () => {
    expect(fuzzy('merge', 'merge-fix')).toBeGreaterThan(fuzzy('merge', 'm-e-r-g-e scattered'));
  });

  it('ranks an earlier substring above a later one', () => {
    expect(fuzzy('fix', 'fix-it')).toBeGreaterThan(fuzzy('fix', 'merge-fix'));
  });

  it('matches case-insensitively', () => {
    expect(fuzzy('MERGE', 'Merge-Fix')).toBeGreaterThan(0);
  });

  it('accepts characters in order but not out of order', () => {
    expect(fuzzy('mfx', 'merge-fix')).toBeGreaterThan(0);
    expect(fuzzy('xfm', 'merge-fix')).toBe(0);
  });

  it('returns 0 when a character is missing', () => {
    expect(fuzzy('zzz', 'merge-fix')).toBe(0);
  });

  it('matches everything for an empty query', () => {
    expect(fuzzy('', 'anything')).toBeGreaterThan(0);
  });
});

describe('shouldFollow', () => {
  const base = { on: true, now: 1000, pausedUntil: 0, focused: 'ws-b', previous: 'ws-a', selectedStation: 'ws-a' as string | null };

  it('follows a real focus change', () => {
    expect(shouldFollow(base)).toBe(true);
  });
  it('follows when nothing is selected', () => {
    expect(shouldFollow({ ...base, selectedStation: null })).toBe(true);
  });
  it('does nothing when following is off', () => {
    expect(shouldFollow({ ...base, on: false })).toBe(false);
  });
  it('does nothing while paused after a manual selection', () => {
    expect(shouldFollow({ ...base, pausedUntil: 2000 })).toBe(false);
    expect(shouldFollow({ ...base, pausedUntil: 1000 })).toBe(true);
  });
  it('does nothing when focus has not changed', () => {
    expect(shouldFollow({ ...base, previous: 'ws-b' })).toBe(false);
  });
  it('does nothing when there is no focused session', () => {
    expect(shouldFollow({ ...base, focused: null })).toBe(false);
    expect(shouldFollow({ ...base, focused: undefined })).toBe(false);
  });
  it('does nothing when the focused session is already selected', () => {
    expect(shouldFollow({ ...base, selectedStation: 'ws-b' })).toBe(false);
  });
});

import { describeEvent } from '../src/ui/EventTicker';

describe('event ticker wording', () => {
  const base = { ts: 0, pr: 1, workpiece_id: 'pr:1', station_id: null };
  it('names districts for phase moves', () => {
    expect(describeEvent({ ...base, kind: 'phase', from: 'review', to: 'merge' })).toBe('Review to Merge');
    expect(describeEvent({ ...base, kind: 'phase', from: 'test', to: 'ci' })).toBe('Build to Review');
    expect(describeEvent({ ...base, kind: 'phase', from: 'merge', to: 'docs' })).toBe('Merge to Shipped · close-out owed');
  });
  it('says merged and deployed plainly', () => {
    expect(describeEvent({ ...base, kind: 'merge', from: null, to: null })).toBe('merged');
    expect(describeEvent({ ...base, kind: 'deploy', from: null, to: null })).toBe('deployed');
  });
  it('says whose move it became, not the raw ball code', () => {
    expect(describeEvent({ ...base, kind: 'ball', from: 'claude', to: 'owner' })).toBe('your move');
    expect(describeEvent({ ...base, kind: 'ball', from: 'owner', to: 'none' })).toBe("nobody's move");
    expect(describeEvent({ ...base, kind: 'ball', from: 'owner', to: null })).toBe("nobody's move");
    expect(describeEvent({ ...base, kind: 'ball', from: 'ci', to: 'design review' })).toBe('waiting on design review');
  });
});
