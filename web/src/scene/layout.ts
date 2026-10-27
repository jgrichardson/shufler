import type { Domain, Phase, Snapshot, Station, Workpiece, BallWho } from '../types';
import { isClosed } from '../lib/derive';
import { BAND_W, GATE_X, PHASES, domainDef, pipelineKey } from '../lib/domains';

export type Vec3 = [number, number, number];

/* World grid (CONTRACT v3, scaled slightly for readable islands). x = phase, z = -lane * LANE_PITCH. */
export const LANE_PITCH = 9;
/** Rows beyond this depth squeeze the pitch uniformly instead of growing the world. */
export const MAX_ROWS_DEPTH = 90;
export const MIN_LANE_PITCH = 5.5;
export const SKY_Y = 5.5;
export const RAMP_END_X = -7;
/** Largest row island; it shrinks with the pitch so islands never touch (radius <= 0.35 pitch). */
export const ROW_ISLAND_R = 3.1;
/** Row islands sit one island width left of the first band. */
export const islandColX = (r: number) => RAMP_END_X - 3 * r;
/** x where the last district band ends; the skyway deck stops here. Follows the live pipeline stages. */
export const skywayEndX = () => (PHASES.length - 0.5) * BAND_W;
/** x of the end-of-belt area (Shipping Dock and Warehouse), just past the last band. */
export const dockX = () => skywayEndX() + 16;
export const POD_PITCH = 4.3;
export const MAX_PODS_PER_CELL = 3;
export const BUILDING_PITCH = 3.4;

/* Pipeline (kanban) mode: lanes squeeze to this pitch and pods regroup into per-district columns. */
export const PIPE_LANE_PITCH = 1.2;
export const PIPE_COLS = 1;
export const PIPE_PITCH_X = 3.9;
export const PIPE_PITCH_Z = 3.4;

export const BALL_ORDER: BallWho[] = ['owner', 'person', 'testers', 'reviewer', 'ci', 'claude', 'closeout', 'none'];

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function rng(seed: number): () => number {
  let a = seed || 1;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let lanePitch = LANE_PITCH;
/** Pitch for n rows: LANE_PITCH until the rows outgrow MAX_ROWS_DEPTH, then squeezed uniformly. */
export function pitchFor(rows: number): number {
  if (rows <= 1) return LANE_PITCH;
  return Math.max(MIN_LANE_PITCH, Math.min(LANE_PITCH, MAX_ROWS_DEPTH / (rows - 1)));
}

export function laneZ(lane: number): number {
  return -lane * lanePitch;
}

export { BAND_W };

/** District landmarks stand behind the board's back edge: offset in z, scale, and roughly how tall they get (local units) so the name strip can float above them. */
export const LANDMARK = { back: 10.5, scale: 2.5, height: 7.6 } as const;

/**
 * The context library stands back-left, level with the district landmarks: west of the first landmark's pad
 * and behind the row islands, so it clears the row headers, the district name strip and the Warehouse.
 * `radius` is its footprint in world units (skin footprint 4.6 times `scale`).
 */
export const LIBRARY = { x: -31, back: 4, scale: 2.5, radius: 11.5, height: 8.4 } as const;

/** Where the library's pad sits: its ground point in world space, a little behind the landmark line. */
export function libraryPos(layout: Pick<SceneLayout, 'bounds'>): Vec3 {
  return [LIBRARY.x, SKY_Y - 0.7, layout.bounds.minZ - 2.4 - LANDMARK.back - LIBRARY.back];
}

/** Centre x of a district band; pods snap to it. */
export function cellX(phase: Phase): number {
  return GATE_X[phase] ?? GATE_X.build;
}

/** x where a district band starts (its bridge spans the lanes here). */
export function gateArchX(phase: Phase): number {
  return cellX(phase) - BAND_W / 2;
}

export interface IslandLayout {
  id: string;
  label: string;
  code: string;
  color: string;
  lane: number | null;
  center: Vec3;
  radius: number;
  /** x stretch so wide islands stay inside their lane band. */
  stretch: number;
  top: number;
  seed: number;
  stationIds: string[];
  isTower: boolean;
}

export interface BuildingLayout {
  stationId: string;
  islandId: string;
  pos: Vec3;
  /** Uniform scale so a building fits its row island. */
  scale: number;
  rotY: number;
  paletteIndex: number;
  slot: number;
}

export interface PodSlot {
  id: string;
  lane: number;
  phase: Phase;
  slot: number;
  count: number;
  /** Items in the cell beyond what is drawn; shown as a crate "+N" in the last slot. */
  overflow: number;
  hidden: boolean;
  pos: Vec3;
  parked: boolean;
  /** Position in the Pipeline kanban; absent for parked items, which sink with their island. */
  pipePos?: Vec3;
}

export interface PipeLayout {
  midZ: number;
  /** z scale applied to the lanes around midZ. */
  laneScale: number;
  /** z of the back edge in Pipeline mode, where the district landmarks move to. */
  backZ: number;
  counts: Partial<Record<Phase, number>>;
}

export interface SceneLayout {
  islands: IslandLayout[];
  buildings: Map<string, BuildingLayout>;
  pods: Map<string, PodSlot>;
  crates: { lane: number; phase: Phase; count: number; pos: Vec3 }[];
  lanes: RowLane[];
  lanePitch: number;
  dock: { center: Vec3; halfDepth: number; top: number };
  bounds: { minZ: number; maxZ: number };
  pipe: PipeLayout;
}

/** One row of the world: a cmux workspace, or the final Unowned row. */
export interface RowLane {
  id: string;
  kind: 'station' | 'unowned';
  stationId: string | null;
  /** Workspace title exactly as cmux shows it. */
  title: string;
  /** cmux group name; '' for ungrouped. */
  group: string;
  /** Area ledger of the row's session, when it runs one. */
  ledgerArea: string | null;
  /** Domain is colour only. */
  domain: Domain;
  z: number;
}

export const UNOWNED_ROW = 'unowned';

const domainOf = (domains: Domain[], id: string): Domain => {
  const d = domains.find((x) => x.id === id);
  if (d) return d;
  const def = domainDef(id);
  return { id: def.id, label: def.label, code: def.code, color: def.color, lane: 0, counts: { live: 0, owner: 0, parked: 0 } } as unknown as Domain;
};

/** Visible workspaces in cmux sidebar order (sidebar_index, else list order); empty ones only when asked. */
export function rowStations(stations: Station[], showEmpty = false): Station[] {
  return stations
    .map((s, i) => ({ s, k: s.row_order ?? s.sidebar_index ?? 10_000 + i }))
    .filter(({ s }) => !s.utility && (showEmpty || (!s.empty && !isClosed(s))))
    .sort((a, b) => a.k - b.k)
    .map(({ s }) => s);
}

export function ballRank(w: Pick<Workpiece, 'ball'>): number {
  const i = BALL_ORDER.indexOf(w.ball.who);
  return i < 0 ? BALL_ORDER.length : i;
}

/** Order inside a cell: whoever holds the ball (you first), then oldest in phase. */
export function cellOrder(a: Workpiece, b: Workpiece): number {
  return ballRank(a) - ballRank(b) || (a.phase_since ?? 0) - (b.phase_since ?? 0) || a.id.localeCompare(b.id);
}

export interface LayoutOptions {
  showEmpty?: boolean;
}

export function computeLayout(snapshot: Pick<Snapshot, 'domains' | 'stations' | 'workpieces'>, opts: LayoutOptions = {}): SceneLayout {
  const rows = rowStations(snapshot.stations, opts.showEmpty);
  const rowOf = new Map(rows.map((s, i) => [s.id, i]));
  // every workpiece sits on the first visible row (sidebar order) of the stations that manage it
  const homeRow = new Map<string, number>();
  let unowned = false;
  for (const w of snapshot.workpieces) {
    const idx = w.station_ids.map((id) => rowOf.get(id)).filter((i): i is number => i != null);
    if (idx.length) homeRow.set(w.id, Math.min(...idx));
    else if (w.phase !== 'shipped') unowned = true;
  }
  const rowCount = rows.length + (unowned ? 1 : 0);
  lanePitch = pitchFor(rowCount);
  // the first row in sidebar order sits at the back, so the column reads top-down like the sidebar
  const rowZ = (i: number) => laneZ(rowCount - 1 - i);
  const lanes: RowLane[] = rows.map((st, i) => ({
    id: st.id,
    kind: 'station',
    stationId: st.id,
    title: st.title,
    group: st.group ?? '',
    ledgerArea: st.ledger_area ?? null,
    domain: domainOf(snapshot.domains, st.domain),
    z: rowZ(i),
  }));
  if (unowned) {
    const unDomain = domainOf(snapshot.domains, 'unassigned');
    lanes.push({ id: UNOWNED_ROW, kind: 'unowned', stationId: null, title: 'Unowned', group: '\u0000unowned', ledgerArea: null, domain: unDomain, z: rowZ(rows.length) });
  }
  const laneOfItem = (w: Workpiece) => homeRow.get(w.id) ?? (unowned ? rows.length : null);

  const R = Math.min(ROW_ISLAND_R, lanePitch * 0.35);
  const colX = islandColX(ROW_ISLAND_R);
  const islandTop = SKY_Y - 2.2;
  const bScale = Math.min(1, R / ROW_ISLAND_R) * 0.9;
  const islands: IslandLayout[] = [];
  const buildings = new Map<string, BuildingLayout>();
  lanes.forEach((l, i) => {
    const center: Vec3 = [colX, islandTop - 0.6, l.z];
    islands.push({
      id: l.id,
      label: l.title,
      code: l.domain.code,
      color: l.domain.color,
      lane: i,
      center,
      radius: R,
      stretch: 1,
      top: islandTop,
      seed: hashString(l.id),
      stationIds: l.stationId ? [l.stationId] : [],
      isTower: false,
    });
    if (l.stationId)
      buildings.set(l.stationId, {
        stationId: l.stationId,
        islandId: l.id,
        pos: [colX, islandTop, l.z],
        scale: bScale,
        rotY: 0,
        paletteIndex: hashString(l.stationId) % 6,
        slot: 0,
      });
  });

  // ---- pods: cell slots per lane x phase; parked items sit in their island's yard
  const pods = new Map<string, PodSlot>();
  const crates: SceneLayout['crates'] = [];
  const cells = new Map<string, Workpiece[]>();
  const yard = new Map<string, Workpiece[]>();
  for (const w of snapshot.workpieces) {
    if (w.phase === 'shipped') continue;
    const lane = laneOfItem(w);
    if (lane == null) continue;
    if (w.parked) {
      const rowId = lanes[lane].id;
      const list = yard.get(rowId) ?? [];
      list.push(w);
      yard.set(rowId, list);
      continue;
    }
    const key = `${lane}|${w.phase}`;
    const list = cells.get(key) ?? [];
    list.push(w);
    cells.set(key, list);
  }
  for (const [key, list] of cells) {
    const [laneStr, phase] = key.split('|') as [string, Phase];
    const lane = Number(laneStr);
    list.sort(cellOrder);
    const overflow = list.length > MAX_PODS_PER_CELL ? list.length - (MAX_PODS_PER_CELL - 1) : 0;
    const drawn = overflow ? MAX_PODS_PER_CELL - 1 : list.length;
    const slots = overflow ? MAX_PODS_PER_CELL : drawn;
    list.forEach((w, slot) => {
      const s = Math.min(slot, slots - 1);
      const x = cellX(phase) + (s - (slots - 1) / 2) * POD_PITCH;
      pods.set(w.id, { id: w.id, lane, phase, slot, count: list.length, overflow, hidden: slot >= drawn, pos: [x, SKY_Y, lanes[lane].z], parked: false });
    });
    if (overflow) {
      const x = cellX(phase) + ((slots - 1) / 2) * POD_PITCH;
      crates.push({ lane, phase, count: overflow, pos: [x, SKY_Y, lanes[lane].z] });
    }
  }
  for (const [rowId, list] of yard) {
    const isl = islands.find((i) => i.id === rowId);
    if (!isl) continue;
    list.sort(cellOrder).forEach((w, k) => {
      // on the island's east shoulder, beside the building, in a short column
      const px = isl.center[0] + isl.radius * 0.55;
      const pz = isl.center[2] + (k - (list.length - 1) / 2) * Math.min(1.1, isl.radius * 0.5);
      pods.set(w.id, {
        id: w.id,
        lane: isl.lane ?? 0,
        phase: w.phase,
        slot: k,
        count: list.length,
        overflow: 0,
        hidden: false,
        pos: [px, isl.top + 0.9, pz],
        parked: true,
      });
    });
  }

  const minZ = lanes.length ? laneZ(lanes.length - 1) : 0;
  const pipe = pipelineColumns(snapshot.workpieces, pods, minZ);
  return {
    islands,
    buildings,
    pods,
    crates,
    lanes,
    lanePitch,
    dock: { center: [dockX(), -1, minZ / 2], halfDepth: Math.max(10, -minZ / 2 + 7), top: -0.4 },
    bounds: { minZ, maxZ: 0 },
    pipe,
  };
}

/**
 * Kanban positions: each district becomes one column of PIPE_COLS-wide rows, sorted by domain order
 * then ball priority, centred on the squeezed lane band. Overflowed items get a slot too.
 */
export function pipelineColumns(workpieces: Workpiece[], pods: Map<string, PodSlot>, minZ: number): PipeLayout {
  const midZ = minZ / 2;
  const laneScale = PIPE_LANE_PITCH / lanePitch;
  const byPhase = new Map<Phase, Workpiece[]>();
  for (const w of workpieces) {
    const slot = pods.get(w.id);
    if (!slot || slot.parked || w.phase === 'shipped') continue;
    const list = byPhase.get(w.phase) ?? [];
    list.push(w);
    byPhase.set(w.phase, list);
  }
  const counts: Partial<Record<Phase, number>> = {};
  let back = midZ + (minZ - midZ) * laneScale;
  for (const [phase, list] of byPhase) {
    list.sort((a, b) => (pods.get(a.id)?.lane ?? 0) - (pods.get(b.id)?.lane ?? 0) || cellOrder(a, b));
    counts[phase] = list.length;
    const rows = Math.ceil(list.length / PIPE_COLS);
    const z0 = midZ - ((rows - 1) / 2) * PIPE_PITCH_Z;
    back = Math.min(back, z0 - 2);
    list.forEach((w, i) => {
      const row = Math.floor(i / PIPE_COLS);
      const inRow = Math.min(PIPE_COLS, list.length - row * PIPE_COLS);
      const col = i % PIPE_COLS;
      pods.get(w.id)!.pipePos = [cellX(phase) + (col - (inRow - 1) / 2) * PIPE_PITCH_X, SKY_Y, z0 + row * PIPE_PITCH_Z];
    });
  }
  return { midZ, laneScale, backZ: back - 2.4, counts };
}

export function layoutKey(s: Pick<Snapshot, 'domains' | 'stations' | 'workpieces'> | null, showEmpty = false): string {
  if (!s) return '';
  return (
    pipelineKey() +
    (showEmpty ? '#e' : '#') +
    '#' +
    s.domains.map((d) => d.id).join(',') +
    '#' +
    s.stations.map((x: Station) => `${x.id}@${x.domain}/${x.row_order ?? ''}:${x.sidebar_index ?? ''}/${x.ledger_area ?? ''}/${x.group ?? ''}/${x.empty ? 1 : 0}${isClosed(x) ? 'c' : ''}${x.utility ? 'u' : ''}/${x.title}`).join(',') +
    '#' +
    s.workpieces.map((w) => `${w.id}@${w.domain}/${w.phase}/${w.parked ? 1 : 0}/${w.ball.who}/${w.station_ids.join('+')}`).join(',')
  );
}

/** One pod per workpiece id, whatever the list holds (first wins). */
export function uniqueById<T extends { id: string }>(list: T[]): T[] {
  const seen = new Set<string>();
  return list.filter((w) => (seen.has(w.id) ? false : (seen.add(w.id), true)));
}

export { PHASES };
