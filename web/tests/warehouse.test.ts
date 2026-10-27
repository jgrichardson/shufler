import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { RACK_CAPACITY, RACK_LEVELS, bayGeometry, baySlot, rackSlot, warehouseGeometry, warehouseRacks } from '../src/scene/warehouseLayout';
import { ridePath } from '../src/scene/Conveyor';
import { skywayEndX } from '../src/scene/layout';
import { pileRows } from '../src/ui/panel/PilePanel';
import { PILE_ALL, PILE_DOCK, selectionStillExists } from '../src/store/reducer';
import type { Domain, Shipped, Snapshot } from '../src/types';

const dom = (id: string) => ({ id }) as Domain;
const layout = {
  lanes: [
    { domain: dom('billing'), z: -18 },
    { domain: dom('auth'), z: -9 },
    { domain: dom('auth'), z: 0 },
  ],
  bounds: { minZ: -18, maxZ: 0 },
  dock: { center: [0, -1, -9] as [number, number, number], halfDepth: 16, top: -0.4 },
};
const ship = (pr: number, domain: string, day: number, closeout_owed = false): Shipped => ({ pr, title: `t${pr}`, merged_at: `2026-10-${String(day).padStart(2, '0')}T10:00:00Z`, deployed: true, domain, closeout_owed });
const shipped = [ship(1, 'auth', 20), ship(2, 'auth', 22, true), ship(3, 'auth', 21), ship(4, 'billing', 19), ship(5, 'mobile', 18)];

describe('warehouse racks', () => {
  const racks = warehouseRacks(layout as never, shipped);

  it('gives one rack per domain at its first row, in lane order, with domains without a row behind', () => {
    expect(racks.map((r) => [r.domain, r.z])).toEqual([
      ['mobile', -22],
      ['billing', -18],
      ['auth', -9],
    ]);
  });

  it('stores closed PRs newest first and leaves close-out owed ones on the dock', () => {
    const p = racks.find((r) => r.domain === 'auth')!;
    expect(p.items.map((s) => s.pr)).toEqual([2, 3, 1]);
    expect(p.stored.map((s) => s.pr)).toEqual([3, 1]);
    expect(p.owed.map((s) => s.pr)).toEqual([2]);
  });

  it('sizes the hall to every rack, with the dock between the skyway end and the hall front', () => {
    const g = warehouseGeometry(layout as never, racks);
    expect(g.zMin).toBeLessThan(-22);
    expect(g.zMax).toBeGreaterThan(0);
    const b = bayGeometry(g);
    expect(b.x0).toBeGreaterThan(skywayEndX());
    expect(b.x1).toBeLessThan(g.frontX);
    expect(g.rackFrontX).toBeGreaterThan(g.frontX);
    expect(g.roofFromX).toBeGreaterThan(g.rackFrontX);
  });

  it('puts the newest crate at the front of the rack and fills a column before moving back', () => {
    const g = warehouseGeometry(layout as never, racks);
    const front = rackSlot(g, -9, 0);
    expect(rackSlot(g, -9, 1)[0]).toBe(front[0]);
    expect(rackSlot(g, -9, 1)[1]).toBeGreaterThan(front[1]);
    expect(rackSlot(g, -9, RACK_LEVELS)[0]).toBeGreaterThan(front[0]);
    expect(rackSlot(g, -9, RACK_CAPACITY + 5)).toEqual(rackSlot(g, -9, RACK_CAPACITY - 1));
  });

  it('lines owed crates up along the conveyor toward the bay door', () => {
    const b = bayGeometry(warehouseGeometry(layout as never, racks));
    expect(baySlot(b, 1)[0]).toBeGreaterThan(baySlot(b, 0)[0]);
    expect(baySlot(b, 5)[0]).toBeLessThan(b.x1);
  });
});

describe('rides to the warehouse', () => {
  const racks = warehouseRacks(layout as never, shipped);
  const g = warehouseGeometry(layout as never, racks);
  const from = new THREE.Vector3(10, 0, -9);

  it('rolls through the bay door onto the rack front in about two seconds', () => {
    const slot = rackSlot(g, -9, 0);
    const legs = ridePath(from, g, { rack: slot }, false);
    expect(legs[legs.length - 1].to.toArray()).toEqual(slot);
    expect(legs[legs.length - 2].to.x).toBeCloseTo(g.frontX + 0.6);
    expect(legs.slice(-2).reduce((a, l) => a + l.dur, 0)).toBeCloseTo(2.0);
  });

  it('stops on the conveyor when a close-out is owed', () => {
    const b = bayGeometry(g);
    const slot = baySlot(b, 0);
    const legs = ridePath(from, g, { bay: slot }, false);
    expect(legs[legs.length - 1].to.toArray()).toEqual(slot);
    expect(legs.every((l) => l.to.x < g.frontX)).toBe(true);
  });
});

describe('shipping dock pile', () => {
  it('lists only shipped PRs that still owe a close-out', () => {
    expect(pileRows({ shipped, workpieces: [] }, PILE_DOCK).map((r) => r.pr)).toEqual([2]);
    expect(pileRows({ shipped, workpieces: [] }, PILE_ALL)).toHaveLength(5);
  });

  it('keeps the dock selection even when nothing is owed', () => {
    const snap = { shipped: [], stations: [], workpieces: [], domains: [] } as unknown as Snapshot;
    expect(selectionStillExists({ kind: 'pile', id: PILE_DOCK }, snap)).toEqual({ kind: 'pile', id: PILE_DOCK });
  });
});
