import { describe, expect, it } from 'vitest';
import { awaySummary, diffSeen, seenOf } from '../src/ui/catchUp';
import type { MotionEvent, Phase } from '../src/types';

const wp = (id: string, phase: Phase) => ({ id, phase }) as never;
const ev = (workpiece_id: string): MotionEvent => ({ ts: 0, kind: 'phase', pr: null, workpiece_id, from: null, to: null, station_id: null });

describe('catch-up replay', () => {
  it('finds pods whose phase changed, in event order', () => {
    const seen = seenOf({ workpieces: [wp('a', 'review'), wp('b', 'review'), wp('c', 'build')] });
    const r = diffSeen(seen, { workpieces: [wp('a', 'qa'), wp('b', 'shipped'), wp('c', 'build'), wp('d', 'plan')], events: [ev('b'), ev('a')] });
    expect(r.moves).toEqual([
      { id: 'b', from: 'review', to: 'shipped' },
      { id: 'a', from: 'review', to: 'qa' },
    ]);
    expect(r.merged).toBe(1);
    expect(r.deployed).toBe(1);
  });

  it('does nothing without a saved view', () => {
    expect(diffSeen(null, { workpieces: [wp('a', 'qa')], events: [] }).moves).toEqual([]);
  });

  it('summarises in plain words', () => {
    expect(awaySummary(3, 1, 2, 6)).toBe('3 merged, 1 deployed, 2 need you');
    expect(awaySummary(0, 0, 1, 4)).toBe('4 moved, 1 needs you');
  });
});
