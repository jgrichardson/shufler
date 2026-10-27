import { describe, expect, it } from 'vitest';
import { MAX_TOASTS, UNREACHABLE_AFTER_FAILURES, PILE_ALL, initialState, reduce, sameSelection, selectionStillExists, type WorldEvent, type WorldState } from '../src/store/reducer';
import { normalizeSnapshot } from '../src/lib/derive';
import { makeMockSnapshot } from '../src/mock/snapshot';
import type { Snapshot } from '../src/types';

const NOW = 1_800_000_000_000;
const snap = (): Snapshot => normalizeSnapshot(makeMockSnapshot(NOW), { now: NOW / 1000 });
const run = (events: WorldEvent[], from: WorldState = initialState) => events.reduce(reduce, from);

describe('snapshot events', () => {
  it('stores the snapshot and its arrival time', () => {
    const s = snap();
    const state = run([{ type: 'snapshot', snapshot: s, at: 12345 }]);
    expect(state.snapshot).toBe(s);
    expect(state.lastMessageAt).toBe(12345);
  });

  it('drops a station selection when that station disappears', () => {
    const s = snap();
    const id = s.stations[0].id;
    let state = run([{ type: 'snapshot', snapshot: s, at: 1 }, { type: 'select', selection: { kind: 'station', id } }]);
    expect(state.selection).toEqual({ kind: 'station', id });
    state = reduce(state, { type: 'snapshot', snapshot: { ...s, stations: s.stations.filter((x) => x.id !== id) }, at: 2 });
    expect(state.selection).toBeNull();
  });

  it('drops an item selection when that item disappears but keeps it while present', () => {
    const s = snap();
    const id = s.workpieces[0].id;
    let state = run([{ type: 'snapshot', snapshot: s, at: 1 }, { type: 'select', selection: { kind: 'item', id } }]);
    state = reduce(state, { type: 'snapshot', snapshot: s, at: 2 });
    expect(state.selection).toEqual({ kind: 'item', id });
    state = reduce(state, { type: 'snapshot', snapshot: { ...s, workpieces: [] }, at: 3 });
    expect(state.selection).toBeNull();
  });

  it('keeps gate selections and the command domain, drops unknown domains', () => {
    const s = snap();
    expect(selectionStillExists({ kind: 'gate', phase: 'merge' }, s)).toEqual({ kind: 'gate', phase: 'merge' });
    expect(selectionStillExists({ kind: 'domain', id: 'command' }, s)).toEqual({ kind: 'domain', id: 'command' });
    expect(selectionStillExists({ kind: 'domain', id: 'no-such-domain' }, s)).toBeNull();
    expect(selectionStillExists(null, s)).toBeNull();
  });

  it('keeps a pile selection while its domain has shipped work, drops it once the domain has none', () => {
    const s = snap();
    const shipped = [{ pr: 1, title: 'a', merged_at: '2026-10-22T10:00:00Z', deployed: true, domain: 'auth' }];
    const withPile = { ...s, shipped };
    expect(selectionStillExists({ kind: 'pile', id: 'auth' }, withPile)).toEqual({ kind: 'pile', id: 'auth' });
    expect(selectionStillExists({ kind: 'pile', id: 'billing' }, withPile)).toBeNull();
    let state = run([{ type: 'snapshot', snapshot: withPile, at: 1 }, { type: 'select', selection: { kind: 'pile', id: 'auth' } }]);
    state = reduce(state, { type: 'snapshot', snapshot: { ...s, shipped: [] }, at: 2 });
    expect(state.selection).toBeNull();
  });

  it('keeps the whole-dock pile even when nothing shipped', () => {
    const s = { ...snap(), shipped: [] };
    expect(selectionStillExists({ kind: 'pile', id: PILE_ALL }, s)).toEqual({ kind: 'pile', id: PILE_ALL });
  });
});

describe('selection and flySeq', () => {
  it('selecting focuses without flying; only an explicit fly: true moves the camera', () => {
    let state = reduce(initialState, { type: 'select', selection: { kind: 'station', id: 'a' } });
    expect(state.flySeq).toBe(0);
    state = reduce(state, { type: 'select', selection: { kind: 'gate', phase: 'review' }, fly: false });
    expect(state.flySeq).toBe(0);
    state = reduce(state, { type: 'select', selection: { kind: 'item', id: 'pr:1' }, fly: true });
    expect(state.flySeq).toBe(1);
    state = reduce(state, { type: 'select', selection: null, fly: true });
    expect(state.flySeq).toBe(1);
  });

  it('resets the tab to overview when the selection changes, keeps it when re-selecting the same thing', () => {
    let state = run([{ type: 'select', selection: { kind: 'station', id: 'a' } }, { type: 'tab', tab: 'actions' }]);
    expect(state.tab).toBe('actions');
    state = reduce(state, { type: 'select', selection: { kind: 'station', id: 'a' } });
    expect(state.tab).toBe('actions');
    state = reduce(state, { type: 'select', selection: { kind: 'station', id: 'b' } });
    expect(state.tab).toBe('overview');
  });

  it('honours an explicit tab on select', () => {
    const state = reduce(initialState, { type: 'select', selection: { kind: 'station', id: 'a' }, tab: 'conversation' });
    expect(state.tab).toBe('conversation');
  });

  it('deselecting clears dim', () => {
    let state = reduce(initialState, { type: 'preset', preset: 'needs' });
    expect(state.dim).toBe(true);
    state = run([{ type: 'select', selection: { kind: 'station', id: 'a' } }], state);
    expect(state.dim).toBe(true);
    state = reduce(state, { type: 'select', selection: null });
    expect(state.dim).toBe(false);
  });

  it('sameSelection compares kind and identity', () => {
    expect(sameSelection(null, null)).toBe(true);
    expect(sameSelection({ kind: 'station', id: 'a' }, { kind: 'item', id: 'a' })).toBe(false);
    expect(sameSelection({ kind: 'gate', phase: 'merge' }, { kind: 'gate', phase: 'merge' })).toBe(true);
    expect(sameSelection({ kind: 'gate', phase: 'merge' }, { kind: 'gate', phase: 'build' })).toBe(false);
    expect(sameSelection({ kind: 'item', id: 'x' }, null)).toBe(false);
  });
});

describe('connection and mock fallback', () => {
  it('never swaps in demo data when the daemon is down; it keeps counting failures', () => {
    let state: WorldState = initialState;
    for (let i = 0; i < UNREACHABLE_AFTER_FAILURES + 5; i++) {
      state = reduce(state, { type: 'ws_failed' });
      expect(state.mock).toBe(false);
      expect(state.conn).toBe('closed');
    }
    expect(state.wsFailures).toBe(UNREACHABLE_AFTER_FAILURES + 5);
  });

  it('returns to live on ws_opened and clears the failure count', () => {
    let state: WorldState = initialState;
    for (let i = 0; i < UNREACHABLE_AFTER_FAILURES; i++) state = reduce(state, { type: 'ws_failed' });
    state = reduce(state, { type: 'ws_opened' });
    expect(state).toMatchObject({ mock: false, conn: 'open', wsFailures: 0 });
  });

  it('in mock mode a non-open conn status stays mock, but open wins', () => {
    let state = reduce(initialState, { type: 'enter_mock' });
    expect(state.conn).toBe('mock');
    state = reduce(state, { type: 'conn', status: 'closed' });
    expect(state.conn).toBe('mock');
    state = reduce(state, { type: 'conn', status: 'open' });
    expect(state.conn).toBe('open');
  });

  it('outside mock mode conn is passed through', () => {
    expect(reduce(initialState, { type: 'conn', status: 'open' }).conn).toBe('open');
  });
});

describe('toasts', () => {
  it('caps the list at MAX_TOASTS keeping the newest', () => {
    let state: WorldState = initialState;
    for (let id = 1; id <= MAX_TOASTS + 3; id++) state = reduce(state, { type: 'toast', id, toast: { ok: true, title: `t${id}`, output: '' } });
    expect(state.toasts).toHaveLength(MAX_TOASTS);
    expect(state.toasts[0].id).toBe(4);
    expect(state.toasts.at(-1)?.id).toBe(MAX_TOASTS + 3);
  });

  it('dismisses by id', () => {
    let state = run([
      { type: 'toast', id: 1, toast: { ok: true, title: 'a', output: '' } },
      { type: 'toast', id: 2, toast: { ok: false, title: 'b', output: '' } },
    ]);
    state = reduce(state, { type: 'dismiss_toast', id: 1 });
    expect(state.toasts.map((t) => t.id)).toEqual([2]);
  });
});

describe('presets, tabs and view reset', () => {
  it('needs preset dims the world and clears the selection', () => {
    const state = run([{ type: 'select', selection: { kind: 'station', id: 'a' } }, { type: 'preset', preset: 'needs' }]);
    expect(state).toMatchObject({ preset: 'needs', dim: true, selection: null, presetSeq: 1 });
  });

  it('domain preset keeps the selection and does not dim', () => {
    const state = run([{ type: 'select', selection: { kind: 'domain', id: 'mobile' } }, { type: 'preset', preset: 'domain' }]);
    expect(state).toMatchObject({ preset: 'domain', dim: false, selection: { kind: 'domain', id: 'mobile' } });
  });

  it('each preset event bumps presetSeq even for the same preset', () => {
    const state = run([{ type: 'preset', preset: 'pipeline' }, { type: 'preset', preset: 'pipeline' }]);
    expect(state.presetSeq).toBe(2);
  });

  it('reset_view clears selection and dim and returns to the overview preset', () => {
    const state = run([{ type: 'preset', preset: 'needs' }, { type: 'select', selection: { kind: 'station', id: 'a' } }, { type: 'reset_view' }]);
    expect(state).toMatchObject({ selection: null, dim: false, preset: 'overview' });
    expect(state.presetSeq).toBe(2);
  });

  it('tab event switches the tab', () => {
    expect(reduce(initialState, { type: 'tab', tab: 'fleet' }).tab).toBe('fleet');
  });
});

describe('pending actions and the command drawer', () => {
  it('request then cancel an action', () => {
    const pending = { action: 'merge' as const, params: { pr: 1 }, label: 'Merge #1' };
    let state = reduce(initialState, { type: 'request_action', pending });
    expect(state.pending).toEqual(pending);
    state = reduce(state, { type: 'cancel_action' });
    expect(state.pending).toBeNull();
  });

  it('command_drawer keeps the previous command when none is supplied', () => {
    let state = reduce(initialState, { type: 'command_drawer', open: true, id: 'tests' });
    state = reduce(state, { type: 'command_drawer', open: false });
    expect(state.commandDrawer).toEqual({ open: false, id: 'tests' });
  });
});

describe('preset history', () => {
  it('remembers the preset before Pipeline so P can toggle back', () => {
    const s = run([{ type: 'preset', preset: 'domain' }, { type: 'preset', preset: 'pipeline' }]);
    expect(s.preset).toBe('pipeline');
    expect(s.prevPreset).toBe('domain');
  });
});
