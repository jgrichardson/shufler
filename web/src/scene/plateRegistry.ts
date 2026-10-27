import * as THREE from 'three';

export interface PlateEntry {
  anchor: THREE.Vector3;
  priority: number;
  el: HTMLElement | null;
  w: number;
  h: number;
  /** Pod labels sit at a fixed offset and skip the collision pass. */
  fixed: boolean;
  /** Follow an animated pod position (podPositions key) instead of the static anchor. */
  follow: string | null;
  lift: number;
  /** Anchor in Pipeline mode; the projector blends toward it with the layout morph. */
  pipe: THREE.Vector3 | null;
  /** Round 12: fixed plates sharing a key (one lane + district) stack upward instead of overlapping. */
  stack: string | null;
}

/** DOM plates register here; the in-canvas projector positions them every frame. */
export const plates = new Map<string, PlateEntry>();

export function registerPlate(
  id: string,
  el: HTMLElement | null,
  anchor: [number, number, number],
  priority: number,
  opts: { fixed?: boolean; follow?: string; lift?: number; pipe?: [number, number, number]; stack?: string } = {},
) {
  if (!el) {
    plates.delete(id);
    return;
  }
  const prev = plates.get(id);
  const entry: PlateEntry = prev ?? { anchor: new THREE.Vector3(), priority, el, w: el.offsetWidth, h: el.offsetHeight, fixed: false, follow: null, lift: 0, pipe: null, stack: null };
  entry.anchor.set(anchor[0], anchor[1], anchor[2]);
  entry.priority = priority;
  entry.el = el;
  entry.w = el.offsetWidth;
  entry.h = el.offsetHeight;
  entry.fixed = !!opts.fixed;
  entry.follow = opts.follow ?? null;
  entry.lift = opts.lift ?? 0;
  entry.stack = opts.stack ?? null;
  entry.pipe = opts.pipe ? (entry.pipe ?? new THREE.Vector3()).set(...opts.pipe) : null;
  plates.set(id, entry);
}

export interface StackRect {
  x: number;
  y: number;
  w: number;
  h: number;
  priority: number;
}

/**
 * Round 12: badges of one lane + district never overlap. The highest priority keeps its natural spot (the lowest
 * slot), and each next one climbs to sit just above whatever it would cover. Returns the y offset (px, <= 0) per rect.
 */
export function stackOffsets(rects: StackRect[], gap = 2): number[] {
  const order = rects.map((_, i) => i).sort((a, b) => rects[b].priority - rects[a].priority || rects[b].y - rects[a].y);
  const placed: { x: number; y: number; w: number; h: number }[] = [];
  const out = new Array<number>(rects.length).fill(0);
  for (const i of order) {
    const r = rects[i];
    let y = r.y;
    for (let guard = 0; guard < rects.length + 1; guard++) {
      const hit = placed.filter((q) => r.x < q.x + q.w && r.x + r.w > q.x && y < q.y + q.h && y + r.h > q.y);
      if (!hit.length) break;
      y = Math.min(...hit.map((q) => q.y)) - r.h - gap;
    }
    placed.push({ x: r.x, y, w: r.w, h: r.h });
    out[i] = y - r.y;
  }
  return out;
}
