import { create } from 'zustand';

/** Morning review round 1, item 1: what the world draws. Persisted per viewer in localStorage. */
export type LabelMode = 'auto' | 'all' | 'none';
export type LayerKey = 'islands' | 'sessions' | 'prs' | 'conflicts' | 'needs' | 'tethers' | 'beams' | 'empty';

export interface Layers {
  islands: boolean;
  sessions: boolean;
  prs: boolean;
  conflicts: boolean;
  needs: boolean;
  tethers: boolean;
  beams: boolean;
  /** Untitled cmux workspaces with no session (round 3); off by default. */
  empty: boolean;
  labels: LabelMode;
}

export const LAYER_KEYS: LayerKey[] = ['islands', 'sessions', 'prs', 'conflicts', 'needs', 'tethers', 'beams', 'empty'];
export const LAYER_LABEL: Record<LayerKey, string> = {
  islands: 'Islands',
  sessions: 'Sessions',
  prs: 'PRs',
  conflicts: 'Conflicts',
  needs: 'Red alerts',
  tethers: 'Tethers',
  beams: 'Beams',
  empty: 'Empty workspaces',
};
export const LAYER_HINT: Record<LayerKey, string> = {
  islands: 'Domain rows and their buildings',
  sessions: 'One building per terminal session',
  prs: 'PR and work-item pods on the board',
  conflicts: 'Merge-conflict markers on pods',
  needs: 'Red highlight on items waiting for you: red pods and beams',
  tethers: 'Arcs from a session to the PRs it owns (hover or select to see them)',
  beams: 'Light beams above items that need attention',
  empty: 'Show untitled, idle terminal workspaces',
};

export const DEFAULT_LAYERS: Layers = { islands: true, sessions: true, prs: true, conflicts: true, needs: true, tethers: true, beams: true, empty: false, labels: 'auto' };
/** Key 0: islands, pods and needs-me only. */
export const CLEAN_LAYERS: Layers = { islands: true, sessions: false, prs: true, conflicts: false, needs: true, tethers: false, beams: false, empty: false, labels: 'auto' };

export const LAYERS_STORAGE_KEY = 'world.layers.v1';

export function parseLayers(raw: string | null | undefined): Layers {
  if (!raw) return { ...DEFAULT_LAYERS };
  try {
    const v = JSON.parse(raw) as Partial<Layers>;
    const out: Layers = { ...DEFAULT_LAYERS };
    for (const k of LAYER_KEYS) if (typeof v[k] === 'boolean') out[k] = v[k] as boolean;
    if (v.labels === 'auto' || v.labels === 'all' || v.labels === 'none') out.labels = v.labels;
    return out;
  } catch {
    return { ...DEFAULT_LAYERS };
  }
}

export const isClean = (l: Layers) => LAYER_KEYS.every((k) => l[k] === CLEAN_LAYERS[k]) && l.labels === CLEAN_LAYERS.labels;

function load(): Layers {
  try {
    return parseLayers(globalThis.localStorage?.getItem(LAYERS_STORAGE_KEY));
  } catch {
    return { ...DEFAULT_LAYERS };
  }
}

function save(l: Layers) {
  try {
    globalThis.localStorage?.setItem(LAYERS_STORAGE_KEY, JSON.stringify(l));
  } catch {
    /* private window or blocked storage: the bar still works for this visit */
  }
}

interface LayerStore extends Layers {
  toggle: (k: LayerKey) => void;
  setLabels: (m: LabelMode) => void;
  /** Key 0 / the Clean button: switch to Clean, or back to the defaults when already clean. */
  toggleClean: () => void;
  reset: () => void;
}

const pick = (s: Layers): Layers => ({ islands: s.islands, sessions: s.sessions, prs: s.prs, conflicts: s.conflicts, needs: s.needs, tethers: s.tethers, beams: s.beams, empty: s.empty, labels: s.labels });

export const useLayers = create<LayerStore>()((set, get) => {
  const commit = (next: Layers) => {
    save(next);
    set(next);
  };
  return {
    ...load(),
    toggle: (k) => commit({ ...pick(get()), [k]: !get()[k] }),
    setLabels: (labels) => commit({ ...pick(get()), labels }),
    toggleClean: () => commit(isClean(pick(get())) ? { ...DEFAULT_LAYERS } : { ...CLEAN_LAYERS }),
    reset: () => commit({ ...DEFAULT_LAYERS }),
  };
});

/* ---------------- LOD and label rules (pure; tested) ---------------- */

export type Lod = 'far' | 'mid' | 'near';

/**
 * Screen pixels per world unit at the camera target. FOV-independent, so the bands hold for any
 * preset. Overview frames the whole world at roughly 5–6 px/unit.
 */
export function pixelsPerUnit(viewportHeight: number, distance: number, fovDeg: number): number {
  return viewportHeight / (2 * Math.max(1e-3, distance) * Math.tan((fovDeg * Math.PI) / 360));
}

export const LOD_MID_PPU = 8.5;
export const LOD_NEAR_PPU = 22;
/** Past this zoom, every pod shows its PR number and the session plates appear. */
export const ZOOM_LABEL_PPU = 9;

export function lodFor(ppu: number): Lod {
  return ppu >= LOD_NEAR_PPU ? 'near' : ppu >= LOD_MID_PPU ? 'mid' : 'far';
}

export type PlateKind = 'island' | 'building' | 'pod' | 'crate' | 'pile' | 'dock';

export interface PlateCtx {
  labels: LabelMode;
  /** Zoomed past ZOOM_LABEL_PPU. */
  zoomed: boolean;
  selected?: boolean;
  hovered?: boolean;
  /** Needs you (red). */
  red?: boolean;
  /** The layer the object belongs to is switched on. */
  layerOn?: boolean;
  /** Needs-me layer switched on. */
  needsOn?: boolean;
  /** LOD band is near. */
  near?: boolean;
}

/**
 * Whether a plate is drawn. Building plates never (round 12 amendment). Auto: district and row headers
 * (outside this rule), every pod badge, needs-me rack badges, the hovered/selected object's plate;
 * everything else only when zoomed in.
 */
export function plateVisible(kind: PlateKind, c: PlateCtx): boolean {
  if (c.layerOn === false) return false;
  // round 12 amendment: the row label names the station, so the building plate is never drawn
  if (kind === 'building') return false;
  if (c.labels === 'none') return false;
  if (c.labels === 'all') return true;
  // round 12: in Auto every pod wears its badge, at every zoom
  if (kind === 'pod') return true;
  if (c.selected || c.hovered) return true;
  if (c.red && c.needsOn !== false && kind === 'pile') return true;
  if (kind === 'island' || kind === 'dock') return true;
  return c.zoomed;
}

/** Pod body: a calm dot until zoomed in or selected, then the full capsule with its number. */
export function podShowsNumber(c: Pick<PlateCtx, 'labels' | 'zoomed' | 'selected'>): boolean {
  if (c.selected) return true;
  if (c.labels === 'none') return false;
  return c.labels === 'all' || c.zoomed;
}

/** Ring drawn around a pod dot: red for needs-me, amber for a merge conflict, none otherwise. */
export function podRing(red: boolean, conflict: boolean, layers: Pick<Layers, 'needs' | 'conflicts'>): 'red' | 'amber' | null {
  if (red && layers.needs) return 'red';
  if (conflict && layers.conflicts) return 'amber';
  return null;
}
