import { describe, expect, it } from 'vitest';
import { debouncePhases, type PhaseDebounce } from '../src/lib/hysteresis';
import type { Snapshot, Workpiece } from '../src/types';

const snap = (phase: Workpiece['phase']) => ({ workpieces: [{ id: 'pr:1', phase } as Workpiece] }) as Snapshot;

describe('phase hysteresis', () => {
  it('shows the first phase immediately', () => {
    const m: PhaseDebounce = new Map();
    expect(debouncePhases(snap('build'), m, 0).workpieces[0].phase).toBe('build');
  });

  it('moves only after 2 snapshots and 60s on the new phase', () => {
    const m: PhaseDebounce = new Map();
    debouncePhases(snap('build'), m, 0);
    const a = debouncePhases(snap('review'), m, 1_000).workpieces[0];
    expect(a.phase).toBe('build');
    expect(a.phase_pending).toBe('review');
    expect(debouncePhases(snap('review'), m, 30_000).workpieces[0].phase).toBe('build');
    expect(debouncePhases(snap('review'), m, 61_000).workpieces[0].phase).toBe('review');
  });

  it('a flicker back resets the window', () => {
    const m: PhaseDebounce = new Map();
    debouncePhases(snap('build'), m, 0);
    debouncePhases(snap('review'), m, 1_000);
    debouncePhases(snap('build'), m, 2_000);
    expect(debouncePhases(snap('review'), m, 70_000).workpieces[0].phase).toBe('build');
  });
});
