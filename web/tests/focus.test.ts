import { describe, expect, it } from 'vitest';
import { computeLayout } from '../src/scene/layout';
import { computeFocus, outside } from '../src/scene/focus';
import { normalizeSnapshot } from '../src/lib/derive';
import type { Snapshot } from '../src/types';

const NOW = 1_800_000_000;
type Item = Record<string, unknown>;

const build = (items: Item[], stations: Item[]): Snapshot =>
  normalizeSnapshot(
    {
      stations,
      workpieces: items.map((w, i) => ({ id: `pr:${100 + i}`, pr: 100 + i, title: `item ${i}`, domain: 'auth', phase: 'build', ball: { who: 'none', name: null }, phase_since: 1000, ...w })),
    },
    { now: NOW },
  );

const ws = (id: string, title: string, i: number, over: Item = {}) => ({ id, title, sidebar_index: i, row_order: i, pr_numbers: [], ...over });

const snap = build(
  [
    { id: 'pr:1', pr: 1, domain: 'auth', phase: 'build', station_ids: ['ws-p'] },
    { id: 'pr:2', pr: 2, domain: 'billing', phase: 'review', station_ids: ['ws-a'] },
    { id: 'pr:3', pr: 3, domain: 'billing', phase: 'build', station_ids: ['ws-a'] },
  ],
  [ws('ws-p', 'AUTH', 0, { ledger_area: 'auth', domain: 'auth' }), ws('ws-a', 'BILLING', 1, { ledger_area: 'billing', domain: 'billing' })],
);
const layout = computeLayout(snap);
const noRed = { items: new Set<string>(), stations: new Set<string>() };
const laneOf = (sid: string) => layout.lanes.findIndex((l) => l.stationId === sid);
const ids = (s: Set<string> | null) => (s ? [...s].sort() : s);

describe('focus: selecting greys out the rest instead of moving the camera', () => {
  it('nothing selected: nothing dims', () => {
    expect(computeFocus(null, false, snap, layout, noRed)).toBeNull();
  });

  it('needs-me view keeps only the red items and sessions lit', () => {
    const red = { items: new Set(['pr:2']), stations: new Set(['ws-a']) };
    const f = computeFocus(null, true, snap, layout, red)!;
    expect(ids(f.items)).toEqual(['pr:2']);
    expect(ids(f.stations)).toEqual(['ws-a']);
    expect(f.lanes).toBeNull();
    expect(f.phases).toBeNull();
  });

  it('a session lights its row and the items it owns', () => {
    const f = computeFocus({ kind: 'station', id: 'ws-a' }, false, snap, layout, noRed)!;
    expect([...f.lanes!]).toEqual([laneOf('ws-a')]);
    expect(f.stations!.has('ws-a')).toBe(true);
    expect(f.stations!.has('ws-p')).toBe(false);
    expect(ids(f.items)).toEqual(['pr:2', 'pr:3']);
    expect(f.warehouse).toBe(false);
  });

  it('a domain lights its rows and every item in that domain', () => {
    const f = computeFocus({ kind: 'domain', id: 'billing' }, false, snap, layout, noRed)!;
    expect(f.lanes!.has(laneOf('ws-a'))).toBe(true);
    expect(f.lanes!.has(laneOf('ws-p'))).toBe(false);
    expect(ids(f.items)).toEqual(['pr:2', 'pr:3']);
  });

  it('a column lights that district and the items in it, across every row', () => {
    const f = computeFocus({ kind: 'gate', phase: 'build' }, false, snap, layout, noRed)!;
    expect([...f.phases!]).toEqual(['build']);
    expect(ids(f.items)).toEqual(['pr:1', 'pr:3']);
    expect(f.lanes!.size).toBe(0);
    expect(f.stations!.size).toBe(0);
  });

  it('an item lights itself and the sessions working on it', () => {
    const f = computeFocus({ kind: 'item', id: 'pr:1' }, false, snap, layout, noRed)!;
    expect(ids(f.items)).toEqual(['pr:1']);
    expect(ids(f.stations)).toEqual(['ws-p']);
    expect(f.lanes!.has(laneOf('ws-p'))).toBe(true);
  });

  it('the shipped pile lights only the warehouse', () => {
    const f = computeFocus({ kind: 'pile', id: 'billing' }, false, snap, layout, noRed)!;
    expect(f.warehouse).toBe(true);
    expect(f.items!.size).toBe(0);
  });

  it('outside() is false with no focus or an all-lit set', () => {
    const f = computeFocus({ kind: 'gate', phase: 'build' }, false, snap, layout, noRed)!;
    expect(outside(f.items, 'pr:2', null)).toBe(false);
    expect(outside(f.phases, 'review', f)).toBe(true);
    expect(outside(f.phases, 'build', f)).toBe(false);
    expect(outside(null, 'x', f)).toBe(false);
  });
});
