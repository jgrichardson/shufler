import { describe, expect, it } from 'vitest';
import { LANE_PITCH, uniqueById, MAX_PODS_PER_CELL, MIN_LANE_PITCH, POD_PITCH, ROW_ISLAND_R, SKY_Y, UNOWNED_ROW, ballRank, cellOrder, cellX, computeLayout, gateArchX, laneZ, pitchFor, rowStations } from '../src/scene/layout';
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

describe('round 10: rows follow row_order, ledger rows marked', () => {
  const stations = [
    ws('ws-f', 'CONTROL', 0, { row_order: 2 }),
    ws('ws-a', 'BILLING', 3, { row_order: 1, ledger_area: 'billing' }),
    ws('ws-p', 'AUTH', 5, { row_order: 0, ledger_area: 'auth' }),
    ws('ws-x', 'ONE_OFF', 1, { row_order: 3 }),
  ];

  it('draws rows in row_order, not sidebar order', () => {
    expect(computeLayout(build([], stations)).lanes.map((l) => l.title)).toEqual(['AUTH', 'BILLING', 'CONTROL', 'ONE_OFF']);
  });

  it('falls back to sidebar_index when the daemon sends no row_order', () => {
    const old = stations.map((st) => ({ ...st, row_order: undefined }));
    expect(computeLayout(build([], old)).lanes.map((l) => l.title)).toEqual(['CONTROL', 'ONE_OFF', 'BILLING', 'AUTH']);
  });

  it('carries the ledger area onto its row and leaves other rows unmarked', () => {
    const lanes = computeLayout(build([], stations)).lanes;
    expect(lanes.map((l) => l.ledgerArea)).toEqual(['auth', 'billing', null, null]);
  });
});

describe('rows: one per cmux workspace', () => {
  const stations = [
    ws('ws-c', 'MOBILE', 2, { group: 'IN_PROGRESS', pr_numbers: [2] }),
    ws('ws-f', 'CONTROL', 0, { pr_numbers: [1, 2] }),
    ws('ws-p', 'AUTH', 1, { group: 'IN_PROGRESS', pr_numbers: [3] }),
    ws('ws-e', 'Group 5', 3, { group: 'ON_HOLD', empty: true }),
  ];
  const s = build(
    [
      { id: 'pr:1', pr: 1, phase: 'build' },
      { id: 'pr:2', pr: 2, phase: 'merge' },
      { id: 'pr:3', pr: 3, phase: 'build', parked: true },
      { id: 'pr:9', pr: 9, phase: 'review' },
      { id: 'pr:8', pr: 8, phase: 'shipped' },
    ],
    stations,
  );
  const layout = computeLayout(s);

  it('orders rows by sidebar_index, hides empty workspaces, and adds Unowned last', () => {
    expect(layout.lanes.map((l) => l.title)).toEqual(['CONTROL', 'AUTH', 'MOBILE', 'Unowned']);
    expect(layout.lanes[3]).toMatchObject({ id: UNOWNED_ROW, kind: 'unowned', stationId: null });
    expect(computeLayout(s, { showEmpty: true }).lanes.map((l) => l.title)).toEqual(['CONTROL', 'AUTH', 'MOBILE', 'Group 5', 'Unowned']);
  });

  it('puts an item on the first row in sidebar order of the stations managing it', () => {
    expect(layout.pods.get('pr:1')).toMatchObject({ lane: 0, phase: 'build', parked: false });
    expect(layout.pods.get('pr:2')).toMatchObject({ lane: 0, phase: 'merge' });
    expect(layout.pods.get('pr:9')).toMatchObject({ lane: 3 });
    expect(layout.pods.has('pr:8')).toBe(false);
    const a = layout.pods.get('pr:1')!;
    expect(a.pos).toEqual([cellX('build'), SKY_Y, layout.lanes[0].z]);
    expect(layout.lanes[0].z).toBeLessThan(layout.lanes[1].z);
    expect(layout.lanes[3].z).toBe(laneZ(0));
  });

  it('parks items on their row island', () => {
    const pod = layout.pods.get('pr:3')!;
    const isl = layout.islands.find((i) => i.id === 'ws-p')!;
    expect(pod.parked).toBe(true);
    expect(pod.lane).toBe(1);
    expect(pod.pos[1]).toBeGreaterThan(isl.top);
  });

  it('draws no group dividers in the world (round 10)', () => {
    expect('dividers' in layout).toBe(false);
  });

  it('gives every row one uniform island in a straight column, one island width left of the first band', () => {
    const xs = new Set(layout.islands.map((i) => i.center[0]));
    const rs = new Set(layout.islands.map((i) => i.radius));
    expect(xs.size).toBe(1);
    expect(rs.size).toBe(1);
    const isl = layout.islands[0];
    expect(isl.radius).toBeLessThanOrEqual(layout.lanePitch * 0.35 + 1e-9);
    expect(gateArchX('brainstorm') - (isl.center[0] + ROW_ISLAND_R)).toBeCloseTo(2 * ROW_ISLAND_R);
    layout.islands.forEach((i, k) => expect(i.center[2]).toBe(layout.lanes[k].z));
    expect(layout.buildings.get('ws-f')?.islandId).toBe('ws-f');
    expect(layout.islands.find((i) => i.id === UNOWNED_ROW)?.stationIds).toEqual([]);
  });
});

describe('row pitch', () => {
  it('keeps the full pitch for few rows and squeezes uniformly for many', () => {
    expect(pitchFor(5)).toBe(LANE_PITCH);
    expect(pitchFor(15)).toBeLessThan(LANE_PITCH);
    expect(pitchFor(15) * 14).toBeCloseTo(90);
    expect(pitchFor(60)).toBe(MIN_LANE_PITCH);
  });

  it('sorts stations without a sidebar_index after those with one, in list order', () => {
    const order = rowStations([{ id: 'b' }, { id: 'a', sidebar_index: 0 }, { id: 'c' }] as never).map((x) => x.id);
    expect(order).toEqual(['a', 'b', 'c']);
  });
});

describe('ordering inside a cell', () => {
  it("the owner's ball goes first, then oldest in phase, then by id", () => {
    const s = build([
      { id: 'pr:new', ball: { who: 'claude', name: null }, phase_since: 3000 },
      { id: 'pr:old', ball: { who: 'claude', name: null }, phase_since: 1000 },
      { id: 'pr:mine', ball: { who: 'owner', name: null }, phase_since: 5000 },
    ]);
    const layout = computeLayout(s);
    const slots = ['pr:mine', 'pr:old', 'pr:new'].map((id) => layout.pods.get(id)!.slot);
    expect(slots).toEqual([0, 1, 2]);
    const xs = ['pr:mine', 'pr:old', 'pr:new'].map((id) => layout.pods.get(id)!.pos[0]);
    expect(xs[1] - xs[0]).toBeCloseTo(POD_PITCH);
    expect(xs[2] - xs[1]).toBeCloseTo(POD_PITCH);
  });

  it('cellOrder ranks ball holders before age and ties by id', () => {
    const mk = (id: string, who: string, since: number) => ({ id, ball: { who }, phase_since: since }) as never;
    expect(ballRank(mk('x', 'owner', 0))).toBeLessThan(ballRank(mk('x', 'claude', 0)));
    expect(cellOrder(mk('a', 'owner', 9), mk('b', 'claude', 1))).toBeLessThan(0);
    expect(cellOrder(mk('a', 'claude', 1), mk('b', 'claude', 9))).toBeLessThan(0);
    expect(cellOrder(mk('a', 'claude', 1), mk('b', 'claude', 1))).toBeLessThan(0);
  });
});

describe('cell overflow', () => {
  const many = (n: number) => build(Array.from({ length: n }, (_, i) => ({ id: `pr:${i}`, phase_since: 1000 + i })));

  it('draws every pod when the cell is at capacity', () => {
    const layout = computeLayout(many(MAX_PODS_PER_CELL));
    expect(layout.crates).toEqual([]);
    for (const pod of layout.pods.values()) expect(pod).toMatchObject({ hidden: false, overflow: 0, count: MAX_PODS_PER_CELL });
  });

  it('beyond capacity hides the extras and adds a +N crate in the last slot', () => {
    const n = MAX_PODS_PER_CELL + 3;
    const layout = computeLayout(many(n));
    const pods = [...layout.pods.values()].sort((a, b) => a.slot - b.slot);
    const visible = pods.filter((p) => !p.hidden);
    const hidden = pods.filter((p) => p.hidden);
    expect(visible).toHaveLength(MAX_PODS_PER_CELL - 1);
    expect(visible.length + hidden.length).toBe(n);
    expect(layout.crates).toHaveLength(1);
    expect(layout.crates[0].count).toBe(hidden.length);
    expect(pods[0].overflow).toBe(hidden.length);
    const lastVisibleX = Math.max(...visible.map((p) => p.pos[0]));
    expect(layout.crates[0].pos[0]).toBeGreaterThan(lastVisibleX);
    for (const p of hidden) expect(p.pos[0]).toBe(layout.crates[0].pos[0]);
  });

  it('overflow in one cell does not affect a neighbouring cell', () => {
    const s = build([
      ...Array.from({ length: 6 }, (_, i) => ({ id: `pr:b${i}`, phase: 'build' })),
      { id: 'pr:r', phase: 'review' },
    ]);
    const layout = computeLayout(s);
    expect(layout.pods.get('pr:r')).toMatchObject({ hidden: false, overflow: 0, count: 1 });
    expect(layout.crates).toHaveLength(1);
  });
});

describe('pipeline columns', () => {
  it('gives every live item in a district its own kanban slot, overflow included', () => {
    const items = Array.from({ length: MAX_PODS_PER_CELL + 4 }, (_, i) => ({ id: `pr:${i}`, phase: 'review' }));
    const layout = computeLayout(build(items));
    const slots = items.map((w) => layout.pods.get(w.id as string)!);
    expect(slots.some((s) => s.hidden)).toBe(true);
    expect(slots.every((s) => s.pipePos)).toBe(true);
    const keys = new Set(slots.map((s) => s.pipePos!.join(',')));
    expect(keys.size).toBe(items.length);
    expect(layout.pipe.counts.review).toBe(items.length);
    for (const s of slots) expect(Math.abs(s.pipePos![0] - cellX('review'))).toBeLessThan(5);
  });

  it('orders a column by row, then ball', () => {
    const s = build(
      [
        { id: 'pr:a', pr: 1, phase: 'review', ball: { who: 'owner', name: null } },
        { id: 'pr:b', pr: 2, phase: 'review', ball: { who: 'none', name: null } },
      ],
      [ws('ws-1', 'ONE', 0, { pr_numbers: [2] }), ws('ws-2', 'TWO', 1, { pr_numbers: [1] })],
    );
    const layout = computeLayout(s);
    expect(layout.pods.get('pr:b')!.pipePos![2]).toBeLessThan(layout.pods.get('pr:a')!.pipePos![2]);
  });

  it('leaves parked items out of the columns', () => {
    const layout = computeLayout(build([{ id: 'pr:p', parked: true }]));
    expect(layout.pods.get('pr:p')!.pipePos).toBeUndefined();
  });
});

describe('one pod per workpiece (#308 was drawn twice)', () => {
  it('collapses duplicate workpiece ids at intake, PR entry first', async () => {
    const { dedupeWorkpieces } = await import('../src/lib/derive');
    const out = dedupeWorkpieces([
      { id: 'pr:308', kind: 'branch', branch: 'dev_x', phase: 'merge', station_ids: ['a'] },
      { id: 'pr:308', kind: 'pr', pr: 308, phase: 'deploy', station_ids: ['b'] },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ kind: 'pr', phase: 'deploy', branch: 'dev_x' });
    expect(out[0].station_ids).toEqual(['b', 'a']);
  });

  it('a phase change leaves exactly one pod slot, in the new band', () => {
    const stations = [ws('ws-p', 'AUTH', 0, { pr_numbers: [308] })];
    const before = build([{ id: 'pr:308', pr: 308, phase: 'merge' }], stations);
    const after = build([{ id: 'pr:308', pr: 308, phase: 'deploy' }, { id: 'pr:308', pr: 308, phase: 'deploy' }], stations);
    expect(after.workpieces.filter((w) => w.id === 'pr:308')).toHaveLength(1);
    const a = computeLayout(before).pods.get('pr:308')!;
    const l = computeLayout(after);
    expect([...l.pods.keys()].filter((k) => k === 'pr:308')).toHaveLength(1);
    expect(l.pods.get('pr:308')!.pos[0]).toBe(cellX('deploy'));
    expect(a.pos[0]).toBe(cellX('merge'));
    expect(uniqueById([{ id: 'x' }, { id: 'x' }, { id: 'y' }]).map((w) => w.id)).toEqual(['x', 'y']);
  });

  it('a session note naming a PR does not ring the pod red; a merge row does', async () => {
    const { needsOwnerIds } = await import('../src/lib/derive');
    const wp = { id: 'pr:1', phase: 'deploy', ball: { who: 'none' } } as never;
    expect(needsOwnerIds({ workpieces: [wp], your_move: [{ kind: 'note', workpiece_id: 'pr:1' }] as never }).has('pr:1')).toBe(false);
    expect(needsOwnerIds({ workpieces: [wp], your_move: [{ kind: 'merge', workpiece_id: 'pr:1' }] as never }).has('pr:1')).toBe(true);
  });
});
