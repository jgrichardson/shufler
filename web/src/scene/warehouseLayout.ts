import type { Shipped } from '../types';
import { skywayEndX, type SceneLayout } from './layout';

/** Round 11: the end of the belt is a small Shipping Dock (loading bay) and a Warehouse with one rack per domain. */
export const WAREHOUSE_DEPTH = 18;
export const WAREHOUSE_WALL_H = 5.2;
/** Front part of the hall (x) left without roof so the racks stay visible from above. */
export const WAREHOUSE_OPEN_FRONT = 11.5;
export const RACK_LEN = 9;
export const RACK_DEPTH = 1.7;
export const RACK_LEVELS = 3;
export const RACK_COLS = 6;
export const RACK_CAPACITY = RACK_LEVELS * RACK_COLS;
export const SHELF_Y = [0.25, 1.45, 2.65] as const;
export const SLOT_PITCH = 1.42;
export const CRATE_SCALE = 0.9;
export const BAY_SLOTS = 6;

export interface Rack {
  domain: string;
  /** Rack z: level with the domain's first row, or behind the rows for a domain without one. */
  z: number;
  /** Every shipped PR of the domain this week, newest merge first. */
  items: Shipped[];
  /** In the warehouse: shipped and closed (no close-out owed), newest first. */
  stored: Shipped[];
  /** Waiting on the dock: close-out still owed. */
  owed: Shipped[];
}

const newestFirst = (a: Shipped, b: Shipped) => (b.merged_at ?? '').localeCompare(a.merged_at ?? '');

/** One rack per domain with shipped work, in lane order; domains without a row go behind the last row. */
export function warehouseRacks(layout: Pick<SceneLayout, 'lanes' | 'bounds'>, shipped: Shipped[]): Rack[] {
  const byDomain = new Map<string, Shipped[]>();
  for (const s of shipped) byDomain.set(s.domain, [...(byDomain.get(s.domain) ?? []), s]);
  const laneZ = new Map<string, number>();
  for (const l of layout.lanes) if (!laneZ.has(l.domain.id)) laneZ.set(l.domain.id, l.z);
  let spare = 0;
  const racks = [...byDomain.entries()].map(([domain, list]) => {
    const items = [...list].sort(newestFirst);
    const z = laneZ.get(domain) ?? layout.bounds.minZ - 4 - spare++ * 4;
    return { domain, z, items, stored: items.filter((s) => !s.closeout_owed), owed: items.filter((s) => s.closeout_owed) };
  });
  // lane order: the back row first, like the rows themselves
  return racks.sort((a, b) => a.z - b.z);
}

export interface WarehouseGeometry {
  /** Floor level (top of the slab). */
  floor: number;
  frontX: number;
  backX: number;
  cx: number;
  cz: number;
  zMin: number;
  zMax: number;
  length: number;
  rackFrontX: number;
  roofFromX: number;
  /** The floating island under dock and warehouse. */
  island: { cx: number; radius: number; stretch: number };
}

export function warehouseGeometry(layout: Pick<SceneLayout, 'bounds' | 'dock'>, racks: Pick<Rack, 'z'>[] = []): WarehouseGeometry {
  const endX = skywayEndX();
  const floor = layout.dock.top + 0.3;
  const frontX = endX + 14;
  const backX = frontX + WAREHOUSE_DEPTH;
  const zMin = Math.min(layout.bounds.minZ, ...racks.map((r) => r.z)) - 4;
  const zMax = layout.bounds.maxZ + 4;
  const length = zMax - zMin;
  const radius = length / 2 + 3;
  const islandCx = (endX + 3 + backX + 2) / 2;
  const halfW = (backX + 2 - (endX + 3)) / 2;
  return {
    floor,
    frontX,
    backX,
    cx: (frontX + backX) / 2,
    cz: (zMin + zMax) / 2,
    zMin,
    zMax,
    length,
    rackFrontX: frontX + 1.2,
    roofFromX: frontX + WAREHOUSE_OPEN_FRONT,
    island: { cx: islandCx, radius, stretch: Math.min(1, halfW / radius) },
  };
}

/** The Shipping Dock: a short loading bay with a roller conveyor into the warehouse's bay door. */
export function bayGeometry(g: Pick<WarehouseGeometry, 'frontX' | 'floor' | 'cz'>) {
  const x0 = skywayEndX() + 4;
  const x1 = g.frontX - 0.4;
  return { x0, x1, cx: (x0 + x1) / 2, z: g.cz, top: g.floor + 0.35, beltY: g.floor + 1.0, len: x1 - x0 };
}

/** Where a stored crate sits: newest at the front of the rack, filling the levels of a column before moving back. */
export function rackSlot(g: Pick<WarehouseGeometry, 'rackFrontX' | 'floor'>, rackZ: number, index: number): [number, number, number] {
  const i = Math.min(index, RACK_CAPACITY - 1);
  const col = Math.floor(i / RACK_LEVELS);
  const level = i % RACK_LEVELS;
  return [g.rackFrontX + 0.85 + col * SLOT_PITCH, g.floor + SHELF_Y[level] + 0.08, rackZ];
}

/** Where a crate waits on the dock conveyor: the newest at the head of the belt, older ones nearer the door. */
export function baySlot(b: ReturnType<typeof bayGeometry>, index: number): [number, number, number] {
  const row = Math.floor(index / BAY_SLOTS);
  const k = index % BAY_SLOTS;
  return [b.x0 + 0.9 + k * ((b.len - 1.6) / (BAY_SLOTS - 1)), b.beltY + row * 1.0, b.z];
}
