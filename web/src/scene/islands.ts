import type { Phase } from '../types';
import { PHASES, pipelineKey } from '../lib/domains';
import { MAX_PODS_PER_CELL, ROW_ISLAND_R, islandColX, skywayEndX, type BuildingLayout, type IslandLayout, type PodSlot, type SceneLayout, type Vec3 } from './layout';

/*
 * Big-island layout: every row (one session) gets a large island of its own, with a loop of track round
 * its building, a stop on the loop for each pipeline stage, and its pods riding the loop at their stage.
 * It is derived from the grid layout, so rows, lane order, cell order, bounds, the dock and the Pipeline
 * board are exactly the grid's; only where islands, buildings, pods and crates stand changes.
 */

/** Island size: radius along z, and the x stretch that makes it a wide oval, like the screen. */
export const BIG_ISLAND_R = 11;
export const BIG_ISLAND_STRETCH = 1.35;
/** Room kept between the block's east edge and the end of the board, where the dock's tags stand. */
export const DOCK_CLEARANCE = 13;
/** Clear sky between islands: across a row, and between rows (room for the name tag under each). */
export const ISLAND_GAP_X = 5.5;
export const ISLAND_GAP_Z = 6;
/** The loop runs on the island's ring road, at this share of the radius. */
export const TRACK_SHARE = 0.68;
/** Half the width of the track; the stop markers stand just outside it. */
export const TRACK_HALF_W = 1.3;
/** Share of the loop left empty at the back, between the last stop and the first. */
export const TRACK_GAP = 0.14;
/** Height of the track's centre line over the island top; pods ride POD_LIFT above it, as on the lanes. */
export const TRACK_Y = 0.15;
export const POD_LIFT = 0.45;
/** Spacing along the loop of pods that share a stop. */
export const ISLAND_POD_PITCH = 2.7;
/** The building stands a little behind the island centre, scaled up to suit the bigger island. */
export const BIG_BUILDING_SCALE = 1.45;
export const BUILDING_BACK = 1;
/** Parked items wait inside the loop, east of the building. */
export const YARD_X = 5.2;

/** Half the island's footprint: x (stretched) and z. */
export const islandHalf = () => ({ x: BIG_ISLAND_R * BIG_ISLAND_STRETCH, z: BIG_ISLAND_R });

/** Centre x of the grid world (row islands to the last district); a small spread of islands sits there. */
const boardMidX = () => (islandColX(ROW_ISLAND_R) - ROW_ISLAND_R + skywayEndX()) / 2;

export interface IslandSpot {
  row: number;
  col: number;
  x: number;
  z: number;
}

/** Columns for n islands: a near-square block. */
export const islandCols = (n: number) => Math.max(1, Math.ceil(Math.sqrt(n)));

/**
 * Where n islands stand, in row order (sidebar order): left to right, back row first, like the grid's
 * rows read top-down. Full blocks stagger alternate rows by half a pitch; a short last row is centred.
 * The block is centred on the board and never reaches past the last district, so the dock and the
 * warehouse keep their place; a wide block grows west instead. The front row sits at z = 0.
 */
export function islandSpread(n: number): IslandSpot[] {
  if (n <= 0) return [];
  const half = islandHalf();
  const px = 2 * half.x + ISLAND_GAP_X;
  const pz = 2 * half.z + ISLAND_GAP_Z;
  const cols = islandCols(n);
  const rows = Math.ceil(n / cols);
  const staggered = rows > 1 && cols > 1 && n % cols === 0;
  const width = (cols - 1) * px + (staggered ? px / 2 : 0) + 2 * half.x;
  const cx = Math.min(boardMidX(), skywayEndX() - DOCK_CLEARANCE - width / 2);
  const out: IslandSpot[] = [];
  for (let i = 0; i < n; i++) {
    const row = Math.floor(i / cols);
    const col = i - row * cols;
    const inRow = Math.min(cols, n - row * cols);
    const shift = staggered ? (row % 2 ? px / 4 : -px / 4) : 0;
    out.push({ row, col, x: cx + (col - (inRow - 1) / 2) * px + shift, z: (row - (rows - 1)) * pz });
  }
  return out;
}

/* ---------------- the loop ---------------- */

export interface TrackStop {
  phase: Exclude<Phase, 'shipped'>;
  /** Arc length from the start of the loop. */
  s: number;
}

/**
 * The loop of track on every big island: an oval on the ring road. It starts at the back centre, runs
 * down the west side, across the front from left to right (the way the grid's columns read) and up the
 * east side; the stops share the loop evenly, leaving a gap at the back between the last and the first.
 */
export interface TrackLoop {
  rx: number;
  rz: number;
  length: number;
  stops: TrackStop[];
  /** Cumulative arc length at SAMPLES + 1 even steps of the angle round the loop. */
  table: Float64Array;
}

const SAMPLES = 720;
let cached: { key: string; loop: TrackLoop } | null = null;

/** Angle on the oval after turning `phi` from the start (back centre), going west first. */
const thetaAt = (phi: number) => -Math.PI / 2 - phi;

/** The loop for the current pipeline stages (one object, shared by every island). */
export function trackLoop(): TrackLoop {
  const key = pipelineKey();
  if (cached?.key === key) return cached.loop;
  const rx = BIG_ISLAND_R * BIG_ISLAND_STRETCH * TRACK_SHARE;
  const rz = BIG_ISLAND_R * TRACK_SHARE;
  const table = new Float64Array(SAMPLES + 1);
  let px = rx * Math.cos(thetaAt(0));
  let pz = rz * Math.sin(thetaAt(0));
  for (let k = 1; k <= SAMPLES; k++) {
    const t = thetaAt((k / SAMPLES) * Math.PI * 2);
    const x = rx * Math.cos(t);
    const z = rz * Math.sin(t);
    table[k] = table[k - 1] + Math.hypot(x - px, z - pz);
    px = x;
    pz = z;
  }
  const length = table[SAMPLES];
  const n = PHASES.length;
  const stops = PHASES.map((phase, i) => ({ phase, s: length * (TRACK_GAP / 2 + (1 - TRACK_GAP) * ((i + 0.5) / n)) }));
  cached = { key, loop: { rx, rz, length, stops, table } };
  return cached.loop;
}

export interface LoopPoint {
  x: number;
  z: number;
  /** Heading of travel (rotation about +y that turns +x onto it). */
  yaw: number;
  /** Unit normal pointing out of the loop. */
  nx: number;
  nz: number;
}

/** Point `s` along the loop (wraps), in the island's frame. */
export function loopPoint(loop: TrackLoop, s: number): LoopPoint {
  const L = loop.length;
  const u = ((s % L) + L) % L;
  const t = loop.table;
  let lo = 0;
  let hi = SAMPLES;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (t[mid] <= u) lo = mid;
    else hi = mid;
  }
  const f = t[hi] > t[lo] ? (u - t[lo]) / (t[hi] - t[lo]) : 0;
  const theta = thetaAt(((lo + f) / SAMPLES) * Math.PI * 2);
  const c = Math.cos(theta);
  const sn = Math.sin(theta);
  // travel turns theta downward, so the heading is -d/dtheta
  const tx = loop.rx * sn;
  const tz = -loop.rz * c;
  const nl = Math.hypot(c / loop.rx, sn / loop.rz) || 1;
  return { x: loop.rx * c, z: loop.rz * sn, yaw: Math.atan2(-tz, tx), nx: c / loop.rx / nl, nz: sn / loop.rz / nl };
}

/** Arc length of a stage's stop; unknown stages sit at the first stop. */
export function stopS(loop: TrackLoop, phase: Phase): number {
  return (loop.stops.find((x) => x.phase === phase) ?? loop.stops[0])?.s ?? 0;
}

/** Points along the loop from s0 to s1 (either direction), about `step` apart, both ends included. */
export function loopArc(loop: TrackLoop, s0: number, s1: number, step = 1.2): LoopPoint[] {
  const n = Math.max(1, Math.ceil(Math.abs(s1 - s0) / step));
  return Array.from({ length: n + 1 }, (_, i) => loopPoint(loop, s0 + ((s1 - s0) * i) / n));
}

/* ---------------- the layout ---------------- */

/**
 * The big-island layout for a grid layout: one island per row in islandSpread order, the row's building
 * just behind its centre, pods at their stage's stop on the loop (pods sharing a stop spaced along it,
 * the overflow crate in the last slot, as in the grid's cells), parked items in a yard inside the loop.
 */
export function islandLayout(grid: SceneLayout): SceneLayout {
  const loop = trackLoop();
  const spots = islandSpread(grid.islands.length);
  const half = islandHalf();
  const islands: IslandLayout[] = grid.islands.map((g, i) => ({
    ...g,
    center: [spots[i].x, g.center[1], spots[i].z],
    radius: BIG_ISLAND_R,
    stretch: BIG_ISLAND_STRETCH,
    track: loop,
  }));
  const byLane = new Map(islands.map((isl) => [isl.lane ?? -1, isl]));
  const buildings = new Map<string, BuildingLayout>();
  for (const [id, b] of grid.buildings) {
    const isl = islands.find((x) => x.id === b.islandId);
    if (!isl) continue;
    buildings.set(id, { ...b, pos: [isl.center[0], isl.top, isl.center[2] - BUILDING_BACK], scale: BIG_BUILDING_SCALE, big: true });
  }
  const onLoop = (isl: IslandLayout, s: number): { pos: Vec3; rotY: number } => {
    const p = loopPoint(loop, s);
    return { pos: [isl.center[0] + p.x, isl.top + TRACK_Y + POD_LIFT, isl.center[2] + p.z], rotY: p.yaw };
  };
  const pods = new Map<string, PodSlot>();
  const yards = new Map<number, PodSlot[]>();
  for (const [id, slot] of grid.pods) {
    const isl = byLane.get(slot.lane);
    if (!isl) continue;
    if (slot.parked) {
      yards.set(slot.lane, [...(yards.get(slot.lane) ?? []), slot]);
      continue;
    }
    // the same slots as the grid's cell: drawn pods, then the crate's slot when the cell overflowed
    const slots = slot.overflow ? MAX_PODS_PER_CELL : slot.count;
    const k = Math.min(slot.slot, slots - 1);
    const s = stopS(loop, slot.phase) + (k - (slots - 1) / 2) * ISLAND_POD_PITCH;
    const at = onLoop(isl, s);
    pods.set(id, { ...slot, pos: at.pos, rotY: at.rotY, track: { loop, origin: [isl.center[0], isl.top + TRACK_Y + POD_LIFT, isl.center[2]], s } });
  }
  for (const [lane, list] of yards) {
    const isl = byLane.get(lane)!;
    list.forEach((slot, k) => {
      const z = isl.center[2] - BUILDING_BACK + (k - (list.length - 1) / 2) * Math.min(1.6, 5 / Math.max(1, list.length - 1));
      pods.set(slot.id, { ...slot, pos: [isl.center[0] + YARD_X, isl.top + TRACK_Y + POD_LIFT, z] });
    });
  }
  const crates = grid.crates.map((c) => {
    const isl = byLane.get(c.lane);
    if (!isl) return c;
    const s = stopS(loop, c.phase) + ((MAX_PODS_PER_CELL - 1) / 2) * ISLAND_POD_PITCH;
    return { ...c, pos: onLoop(isl, s).pos };
  });
  const xs = islands.map((i) => i.center[0]);
  const zs = islands.map((i) => i.center[2]);
  const frame = islands.length
    ? { minX: Math.min(...xs) - half.x, maxX: Math.max(...xs) + half.x, minZ: Math.min(...zs) - half.z, maxZ: Math.max(...zs) + half.z }
    : { minX: 0, maxX: 0, minZ: 0, maxZ: 0 };
  return { ...grid, islands, buildings, pods, crates, mode: 'islands', frame, grid };
}
