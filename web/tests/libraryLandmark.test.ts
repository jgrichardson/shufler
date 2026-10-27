import { describe, expect, it } from 'vitest';
import { initialState, reduce, sameSelection, selectionStillExists, type WorldState } from '../src/store/reducer';
import { computeFocus } from '../src/scene/focus';
import { BAND_W, LANDMARK, LIBRARY, cellX, computeLayout, libraryPos } from '../src/scene/layout';
import { PHASES } from '../src/lib/domains';
import { owedSessions } from '../src/lib/library';
import { dropTarget } from '../src/ui/library/drag';
import { normalizeSnapshot } from '../src/lib/derive';
import { makeMockSnapshot } from '../src/mock/snapshot';
import type { Snapshot } from '../src/types';

const NOW = 1_800_000_000_000;
const snap = (): Snapshot => normalizeSnapshot(makeMockSnapshot(NOW), { now: NOW / 1000 });
const LIB = { kind: 'library' } as const;

describe('library selection', () => {
  it('selects the library and opens the overview tab', () => {
    const s = reduce({ ...initialState, tab: 'data' }, { type: 'select', selection: LIB });
    expect(s.selection).toEqual(LIB);
    expect(s.tab).toBe('overview');
  });

  it('flies on an explicit fly, or with flyOnSelect when the selection changes', () => {
    expect(reduce(initialState, { type: 'select', selection: LIB }).flySeq).toBe(0);
    expect(reduce(initialState, { type: 'select', selection: LIB, fly: true }).flySeq).toBe(1);
    const pref: WorldState = { ...initialState, flyOnSelect: true };
    const once = reduce(pref, { type: 'select', selection: LIB });
    expect(once.flySeq).toBe(1);
    // clicking the building again is not a new selection, so the camera stays
    expect(reduce(once, { type: 'select', selection: LIB }).flySeq).toBe(1);
    expect(reduce(pref, { type: 'select', selection: LIB, fly: false }).flySeq).toBe(0);
  });

  it('is its own kind of selection and survives snapshots', () => {
    expect(sameSelection(LIB, { kind: 'library' })).toBe(true);
    expect(sameSelection(LIB, { kind: 'pile', id: 'all' })).toBe(false);
    expect(sameSelection(LIB, null)).toBe(false);
    expect(selectionStillExists(LIB, snap())).toEqual(LIB);
  });

  it('keeps the rows lit (they are drop targets) and greys the library out for other selections', () => {
    const s = snap();
    const layout = computeLayout(s);
    const red = { items: new Set<string>(), stations: new Set<string>() };
    expect(computeFocus(LIB, false, s, layout, red)).toBeNull();
    expect(computeFocus({ kind: 'station', id: s.stations[0].id }, false, s, layout, red)?.library).toBe(false);
    expect(computeFocus({ kind: 'pile', id: 'all' }, false, s, layout, red)?.library).toBe(false);
    expect(computeFocus(null, true, s, layout, red)?.library).toBe(true);
  });
});

describe('library placement', () => {
  const layout = computeLayout(snap());
  const [x, , z] = libraryPos(layout);
  const landmarkR = 4.6 * LANDMARK.scale;

  it('stands clear of the first district landmark and the strip over it', () => {
    const first = cellX(PHASES[0]);
    const zLandmark = layout.bounds.minZ - 2.4 - LANDMARK.back;
    expect(Math.hypot(first - x, zLandmark - z)).toBeGreaterThan(LIBRARY.radius + landmarkR);
    // the strip starts at the first band's left edge
    expect(x + LIBRARY.radius).toBeLessThan(first - BAND_W / 2);
  });

  it('stands clear of every row island', () => {
    for (const isl of layout.islands) expect(Math.hypot(isl.center[0] - x, isl.center[2] - z)).toBeGreaterThan(LIBRARY.radius + isl.radius);
  });

  it('stands behind the back row, so its tag floats above the row headers', () => {
    expect(z + LIBRARY.radius).toBeLessThan(layout.bounds.minZ);
  });
});

describe('library drop target', () => {
  const hover = { kind: 'station' as const, id: 'ws-b', x: 0, y: 0 };

  it('a row header wins over the scene', () => {
    expect(dropTarget({ rowStation: 'ws-a', chrome: false, canvas: false }, hover)).toBe('ws-a');
  });

  it('over the canvas, the session the scene is hovering', () => {
    expect(dropTarget({ rowStation: null, chrome: false, canvas: true }, hover)).toBe('ws-b');
    expect(dropTarget({ rowStation: null, chrome: false, canvas: true }, null)).toBeNull();
    expect(dropTarget({ rowStation: null, chrome: false, canvas: true }, { kind: 'item', id: 'pr:1', x: 0, y: 0 })).toBeNull();
  });

  it('never the panel, the library tag or other chrome, even with a stale scene hover', () => {
    expect(dropTarget({ rowStation: null, chrome: true, canvas: false }, hover)).toBeNull();
    expect(dropTarget({ rowStation: null, chrome: false, canvas: false }, hover)).toBeNull();
  });
});

describe('owedSessions', () => {
  it('counts sessions with something owed', () => {
    expect(owedSessions(undefined)).toBe(0);
    expect(owedSessions({ a: ['x'], b: [], c: ['x', 'y'] })).toBe(2);
  });
});
