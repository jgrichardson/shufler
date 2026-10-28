import { describe, expect, it } from 'vitest';
import { MAX_PODS_PER_CELL, computeLayout, skywayEndX } from '../src/scene/layout';
import {
  BIG_BUILDING_SCALE,
  ISLAND_POD_PITCH,
  POD_LIFT,
  TRACK_GAP,
  TRACK_Y,
  YARD_X,
  islandCols,
  islandHalf,
  islandLayout,
  islandSpread,
  loopArc,
  loopPoint,
  stopS,
  trackLoop,
} from '../src/scene/islands';
import { PHASES } from '../src/lib/domains';
import { normalizeSnapshot } from '../src/lib/derive';
import type { Snapshot } from '../src/types';

const NOW = 1_800_000_000;
type Item = Record<string, unknown>;

const build = (items: Item[], stations: Item[] = []): Snapshot =>
  normalizeSnapshot(
    {
      stations,
      workpieces: items.map((w, i) => ({ id: `pr:${100 + i}`, pr: 100 + i, title: `item ${i}`, domain: 'auth', phase: 'build', ball: { who: 'none', name: null }, phase_since: 1000, ...w })),
    },
    { now: NOW },
  );

const ws = (id: string, title: string, sidebar_index: number, over: Item = {}) => ({ id, title, sidebar_index, pr_numbers: [], ...over });

/** Two islands' footprints (boxes round the stretched ovals) do not touch. */
const apart = (a: { x: number; z: number }, b: { x: number; z: number }) => {
  const h = islandHalf();
  return Math.abs(a.x - b.x) >= 2 * h.x - 1e-9 || Math.abs(a.z - b.z) >= 2 * h.z - 1e-9;
};

describe('big islands: the spread', () => {
  it.each([1, 5, 16, 40])('places %i islands, one per session, with no overlaps', (n) => {
    const spots = islandSpread(n);
    expect(spots).toHaveLength(n);
    for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) expect(apart(spots[i], spots[j]), `${i} and ${j}`).toBe(true);
  });

  it.each([1, 5, 16, 40])('keeps %i islands west of the dock and the front row at z = 0', (n) => {
    const spots = islandSpread(n);
    const half = islandHalf();
    for (const s of spots) expect(s.x + half.x).toBeLessThanOrEqual(skywayEndX());
    expect(Math.max(...spots.map((s) => s.z))).toBe(0);
  });

  it('reads in sidebar order: left to right, back row first', () => {
    const spots = islandSpread(5);
    expect(islandCols(5)).toBe(3);
    expect(spots.map((s) => [s.row, s.col])).toEqual([
      [0, 0],
      [0, 1],
      [0, 2],
      [1, 0],
      [1, 1],
    ]);
    expect(spots[0].z).toBeLessThan(spots[3].z);
    expect(spots[0].x).toBeLessThan(spots[1].x);
    expect(spots[1].x).toBeLessThan(spots[2].x);
  });

  it('centres a short last row under the row above it', () => {
    const spots = islandSpread(5);
    const mid = (a: number, b: number) => (a + b) / 2;
    expect(mid(spots[3].x, spots[4].x)).toBeCloseTo(spots[1].x);
  });

  it('staggers alternate rows of a full block by half a pitch', () => {
    const spots = islandSpread(16);
    expect(islandCols(16)).toBe(4);
    const px = spots[1].x - spots[0].x;
    expect(spots[4].x - spots[0].x).toBeCloseTo(px / 2);
    expect(spots[8].x).toBeCloseTo(spots[0].x);
  });

  it('a single island stands alone, with nothing to stagger', () => {
    expect(islandSpread(1)).toEqual([expect.objectContaining({ row: 0, col: 0, z: 0 })]);
    expect(islandSpread(0)).toEqual([]);
  });
});

describe('big islands: the loop of track', () => {
  const loop = trackLoop();

  it('has a stop for every stage, in pipeline order, evenly spaced, with a gap at the back', () => {
    expect(loop.stops.map((s) => s.phase)).toEqual([...PHASES]);
    const gaps = loop.stops.slice(1).map((s, i) => s.s - loop.stops[i].s);
    for (const g of gaps) expect(g).toBeCloseTo(gaps[0]);
    const backGap = loop.length - loop.stops[loop.stops.length - 1].s + loop.stops[0].s;
    expect(backGap).toBeCloseTo(gaps[0] + loop.length * TRACK_GAP);
  });

  it('runs west from the back, across the front left to right, then up the east side', () => {
    const at = (phase: (typeof PHASES)[number]) => loopPoint(loop, stopS(loop, phase));
    const first = at(PHASES[0]);
    const last = at(PHASES[PHASES.length - 1]);
    expect(loopPoint(loop, 0).z).toBeCloseTo(-loop.rz);
    expect(first.x).toBeLessThan(0);
    expect(last.x).toBeGreaterThan(0);
    // the middle stage sits on the front (+z) side
    expect(at(PHASES[Math.floor(PHASES.length / 2)]).z).toBeGreaterThan(0);
  });

  it('every point sits on the oval, and wraps round', () => {
    for (let k = 0; k < 50; k++) {
      const p = loopPoint(loop, (k / 50) * loop.length);
      expect((p.x / loop.rx) ** 2 + (p.z / loop.rz) ** 2).toBeCloseTo(1, 4);
      expect(Math.hypot(p.nx, p.nz)).toBeCloseTo(1);
    }
    const a = loopPoint(loop, 3);
    const b = loopPoint(loop, 3 + loop.length);
    expect(b.x).toBeCloseTo(a.x);
    expect(b.z).toBeCloseTo(a.z);
  });

  it('an arc between two stops starts and ends on them, in small steps', () => {
    const s0 = loop.stops[0].s;
    const s1 = loop.stops[3].s;
    const arc = loopArc(loop, s0, s1);
    expect(arc[0].x).toBeCloseTo(loopPoint(loop, s0).x);
    expect(arc[arc.length - 1].z).toBeCloseTo(loopPoint(loop, s1).z);
    for (let i = 1; i < arc.length; i++) expect(Math.hypot(arc[i].x - arc[i - 1].x, arc[i].z - arc[i - 1].z)).toBeLessThanOrEqual(1.2 + 1e-6);
  });

  it('unknown stages fall back to the first stop', () => {
    expect(stopS(loop, 'shipped')).toBe(loop.stops[0].s);
  });
});

describe('big islands: the layout', () => {
  const stations = [
    ws('ws-a', 'AUTH', 0, { pr_numbers: [1, 2, 3] }),
    ws('ws-b', 'BILLING', 1, { pr_numbers: [4, 5] }),
    ws('ws-c', 'MOBILE', 2, { pr_numbers: [6] }),
  ];
  const s = build(
    [
      { id: 'pr:1', pr: 1, phase: 'build' },
      { id: 'pr:2', pr: 2, phase: 'build' },
      { id: 'pr:3', pr: 3, phase: 'review' },
      { id: 'pr:4', pr: 4, phase: 'plan' },
      { id: 'pr:5', pr: 5, phase: 'qa', parked: true },
      { id: 'pr:6', pr: 6, phase: 'merge' },
    ],
    stations,
  );
  const grid = computeLayout(s);
  const isl = islandLayout(grid);
  const loop = trackLoop();
  const islandOf = (lane: number) => isl.islands.find((i) => i.lane === lane)!;

  it('keeps the grid for everything that is not a session: lanes, bounds, dock, warehouse', () => {
    expect(isl.mode).toBe('islands');
    expect(isl.grid).toBe(grid);
    expect(isl.lanes).toBe(grid.lanes);
    expect(isl.bounds).toEqual(grid.bounds);
    expect(grid.mode).toBeUndefined();
  });

  it('gives every session a big island with the loop, at its spot in the spread', () => {
    const spots = islandSpread(grid.islands.length);
    expect(isl.islands.map((i) => i.id)).toEqual(grid.islands.map((i) => i.id));
    isl.islands.forEach((i, k) => {
      expect(i.track).toBe(loop);
      expect(i.center[0]).toBeCloseTo(spots[k].x);
      expect(i.center[2]).toBeCloseTo(spots[k].z);
    });
  });

  it('stands each building on its island, scaled up', () => {
    for (const [, b] of isl.buildings) {
      const home = isl.islands.find((i) => i.id === b.islandId)!;
      expect(b.big).toBe(true);
      expect(b.scale).toBe(BIG_BUILDING_SCALE);
      expect(b.pos[0]).toBeCloseTo(home.center[0]);
      expect(Math.abs(b.pos[2] - home.center[2])).toBeLessThan(islandHalf().z);
    }
  });

  it('puts each pod on its own island, at its stage stop on the loop', () => {
    const pod = isl.pods.get('pr:6')!;
    const home = islandOf(pod.lane);
    const p = loopPoint(loop, stopS(loop, 'merge'));
    expect(pod.track?.s).toBeCloseTo(stopS(loop, 'merge'));
    expect(pod.pos[0]).toBeCloseTo(home.center[0] + p.x);
    expect(pod.pos[1]).toBeCloseTo(home.top + TRACK_Y + POD_LIFT);
    expect(pod.pos[2]).toBeCloseTo(home.center[2] + p.z);
    expect(pod.rotY).toBeCloseTo(p.yaw);
  });

  it('spaces pods that share a stop along the track, a pitch apart, either side of it', () => {
    const a = isl.pods.get('pr:1')!;
    const b = isl.pods.get('pr:2')!;
    expect(a.lane).toBe(b.lane);
    const ss = [a.track!.s, b.track!.s].sort((x, y) => x - y);
    expect(ss[1] - ss[0]).toBeCloseTo(ISLAND_POD_PITCH);
    expect((ss[0] + ss[1]) / 2).toBeCloseTo(stopS(loop, 'build'));
  });

  it('keeps every drawn pod inside its own island', () => {
    const h = islandHalf();
    for (const [, pod] of isl.pods) {
      const home = islandOf(pod.lane);
      const dx = (pod.pos[0] - home.center[0]) / h.x;
      const dz = (pod.pos[2] - home.center[2]) / h.z;
      expect(dx * dx + dz * dz).toBeLessThan(1);
    }
  });

  it('parks parked items in a yard beside the building, off the track', () => {
    const parked = isl.pods.get('pr:5')!;
    const home = islandOf(parked.lane);
    expect(parked.track).toBeUndefined();
    expect(parked.pos[0]).toBeCloseTo(home.center[0] + YARD_X);
  });

  it('frames all the islands', () => {
    const h = islandHalf();
    for (const i of isl.islands) {
      expect(i.center[0] - h.x).toBeGreaterThanOrEqual(isl.frame!.minX - 1e-9);
      expect(i.center[0] + h.x).toBeLessThanOrEqual(isl.frame!.maxX + 1e-9);
      expect(i.center[2] - h.z).toBeGreaterThanOrEqual(isl.frame!.minZ - 1e-9);
      expect(i.center[2] + h.z).toBeLessThanOrEqual(isl.frame!.maxZ + 1e-9);
    }
  });

  it('puts an overflowing cell’s crate in the last slot at its stop', () => {
    const many = build(
      Array.from({ length: MAX_PODS_PER_CELL + 3 }, (_, k) => ({ id: `pr:${k + 1}`, pr: k + 1, phase: 'build' })),
      [ws('ws-a', 'AUTH', 0, { pr_numbers: Array.from({ length: MAX_PODS_PER_CELL + 3 }, (_, k) => k + 1) })],
    );
    const g = computeLayout(many);
    const out = islandLayout(g);
    expect(out.crates).toHaveLength(g.crates.length);
    expect(g.crates.length).toBeGreaterThan(0);
    const home = out.islands[0];
    const p = loopPoint(loop, stopS(loop, 'build') + ((MAX_PODS_PER_CELL - 1) / 2) * ISLAND_POD_PITCH);
    expect(out.crates[0].pos[0]).toBeCloseTo(home.center[0] + p.x);
    expect(out.crates[0].pos[2]).toBeCloseTo(home.center[2] + p.z);
  });

  it('copes with 40 sessions: one island each, none overlapping', () => {
    const big = build([], Array.from({ length: 40 }, (_, k) => ws(`ws-${k}`, `S${k}`, k)));
    const out = islandLayout(computeLayout(big));
    expect(out.islands).toHaveLength(computeLayout(big).islands.length);
    const pts = out.islands.map((i) => ({ x: i.center[0], z: i.center[2] }));
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) expect(apart(pts[i], pts[j])).toBe(true);
  });
});
