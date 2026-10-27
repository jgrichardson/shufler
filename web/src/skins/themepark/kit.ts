import * as THREE from 'three';
import { useResolvedTheme, useSkinPalette } from '../api';
import { PARK, type ParkPalette } from './palette';

/*
 * Theme Park kit: textures (Poly Haven, CC0; see ASSETS.md), geometry helpers and the shared materials.
 * Textures load without suspending: materials exist at once and the images fill in when they arrive, so
 * the board never blanks while assets stream. Geometry is procedural and merged per material, so a whole
 * row of track is a handful of draw calls.
 */

export const ASSET_BASE = `${import.meta.env.BASE_URL}skins/themepark/`;

const loader = typeof document !== 'undefined' ? new THREE.TextureLoader() : null;
const sources = new Map<string, THREE.Texture>();

/** A repeating texture from the skin's asset folder; the image is shared between repeats. */
export function tex(file: string, srgb: boolean, repeat: [number, number] = [1, 1]): THREE.Texture | null {
  if (!loader) return null;
  let base = sources.get(file);
  if (!base) {
    base = loader.load(ASSET_BASE + file);
    base.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    base.wrapS = base.wrapT = THREE.RepeatWrapping;
    base.anisotropy = 4;
    sources.set(file, base);
  }
  if (repeat[0] === 1 && repeat[1] === 1) return base;
  const t = base.clone();
  t.repeat.set(repeat[0], repeat[1]);
  return t;
}

/**
 * Merges geometries into one indexed geometry, keeping the attributes all of them share. A local helper:
 * importing three/examples pulls a second copy of three into the dev bundle.
 */
export function mergeGeometries(list: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const names = Object.keys(list[0].attributes).filter((n) => list.every((g) => g.getAttribute(n)));
  const out = new THREE.BufferGeometry();
  let vCount = 0;
  let iCount = 0;
  for (const g of list) {
    vCount += g.getAttribute('position').count;
    iCount += g.index ? g.index.count : g.getAttribute('position').count;
  }
  for (const name of names) {
    const size = list[0].getAttribute(name).itemSize;
    const arr = new Float32Array(vCount * size);
    let o = 0;
    for (const g of list) {
      const a = g.getAttribute(name) as THREE.BufferAttribute;
      for (let i = 0; i < a.count; i++) for (let k = 0; k < size; k++) arr[o + i * size + k] = a.getComponent(i, k);
      o += a.count * size;
    }
    out.setAttribute(name, new THREE.BufferAttribute(arr, size));
  }
  const index = new Uint32Array(iCount);
  let base = 0;
  let io = 0;
  for (const g of list) {
    const n = g.getAttribute('position').count;
    if (g.index) for (let i = 0; i < g.index.count; i++) index[io++] = g.index.getX(i) + base;
    else for (let i = 0; i < n; i++) index[io++] = i + base;
    base += n;
  }
  out.setIndex(new THREE.BufferAttribute(index, 1));
  return out;
}

/** Collects geometries by bucket name and merges each bucket once. */
export class Bins {
  private bins = new Map<string, THREE.BufferGeometry[]>();
  add(key: string, g: THREE.BufferGeometry) {
    const list = this.bins.get(key);
    if (list) list.push(g);
    else this.bins.set(key, [g]);
    return g;
  }
  merged(): Record<string, THREE.BufferGeometry> {
    const out: Record<string, THREE.BufferGeometry> = {};
    for (const [k, list] of this.bins) out[k] = mergeGeometries(list);
    return out;
  }
}

/** A box whose UVs repeat with its size (density = repeats per unit), so paving and planks stay in scale. */
export function texturedBox(w: number, h: number, d: number, density = 0.6): THREE.BoxGeometry {
  const g = new THREE.BoxGeometry(w, h, d);
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  const faces: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++)
    for (let i = 0; i < 4; i++) {
      const k = f * 4 + i;
      uv.setXY(k, uv.getX(k) * faces[f][0] * density, uv.getY(k) * faces[f][1] * density);
    }
  return g;
}

/** A box placed at (x, y, z), optionally turned about y. */
export function box(w: number, h: number, d: number, x: number, y: number, z: number, density = 0.6, rotY = 0): THREE.BufferGeometry {
  const g = texturedBox(w, h, d, density);
  if (rotY) g.rotateY(rotY);
  return g.translate(x, y, z);
}

/** A cylinder (tube, post) from point a to point b. */
export function strut(a: THREE.Vector3, b: THREE.Vector3, r: number, seg = 6): THREE.BufferGeometry {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r, r, len, seg, 1, false);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  g.applyQuaternion(q);
  const m = a.clone().add(b).multiplyScalar(0.5);
  return g.translate(m.x, m.y, m.z);
}

/** A vertical post from y0 to y1 at (x, z). */
export function post(x: number, z: number, y0: number, y1: number, r: number, seg = 8): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(r, r, y1 - y0, seg).translate(x, (y0 + y1) / 2, z);
}

/** Strips normals and UVs so a self-lit geometry merges with others of the same kind. */
export function bare(g: THREE.BufferGeometry): THREE.BufferGeometry {
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  return g;
}

/**
 * A striped cone or tent roof: alternating gores in `a` and `b` (vertex colours), radius r, height h,
 * with a little scalloped valance under the eave when `valance` is set.
 */
export function stripedTent(r: number, h: number, gores: number, a: string, b: string, valance = 0): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const ca = new THREE.Color(a);
  const cb = new THREE.Color(b);
  for (let i = 0; i < gores; i++) {
    const t0 = (i / gores) * Math.PI * 2;
    const t1 = ((i + 1) / gores) * Math.PI * 2;
    // a slightly concave gore: apex, mid ring pulled in, eave
    const g = new THREE.BufferGeometry();
    const pts: number[] = [];
    const ring = (t: number, s: number, y: number) => [Math.cos(t) * r * s, y, Math.sin(t) * r * s];
    const apex = [0, h, 0];
    const m0 = ring(t0, 0.48, h * 0.42), m1 = ring(t1, 0.48, h * 0.42);
    const e0 = ring(t0, 1, 0), e1 = ring(t1, 1, 0);
    pts.push(...apex, ...m1, ...m0, ...m0, ...m1, ...e1, ...m0, ...e1, ...e0);
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    g.computeVertexNormals();
    const c = i % 2 ? cb : ca;
    const col = new Float32Array(9 * 3);
    for (let k = 0; k < 9; k++) col.set([c.r, c.g, c.b], k * 3);
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    parts.push(g);
    if (valance > 0) {
      // a pennant flap under each gore
      const v = new THREE.BufferGeometry();
      const tm = (t0 + t1) / 2;
      const p0 = ring(t0, 1, 0), p1 = ring(t1, 1, 0), pm = ring(tm, 1.01, -valance);
      v.setAttribute('position', new THREE.Float32BufferAttribute([...p0, ...p1, ...pm, ...p1, ...p0, ...pm], 3));
      v.computeVertexNormals();
      const vc = new Float32Array(6 * 3);
      for (let k = 0; k < 6; k++) vc.set([c.r, c.g, c.b], k * 3);
      v.setAttribute('color', new THREE.BufferAttribute(vc, 3));
      parts.push(v);
    }
  }
  return mergeGeometries(parts);
}

/** Gives a geometry a flat vertex colour, so differently coloured parts can share one vertex-coloured material. */
export function paint(g: THREE.BufferGeometry, color: string | THREE.Color, k = 1): THREE.BufferGeometry {
  const c = new THREE.Color(color).multiplyScalar(k);
  const n = g.getAttribute('position').count;
  const col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

/* ---------- materials ---------- */

export interface Kit {
  p: ParkPalette;
  light: boolean;
  lawn: THREE.MeshStandardMaterial;
  paving: THREE.MeshStandardMaterial;
  pavingDark: THREE.MeshStandardMaterial;
  /** Quiet park floor under the board: the paving's relief without its busy pattern. */
  floor: THREE.MeshStandardMaterial;
  floorDark: THREE.MeshStandardMaterial;
  curb: THREE.MeshStandardMaterial;
  plank: THREE.MeshStandardMaterial;
  hedge: THREE.MeshStandardMaterial;
  trunk: THREE.MeshStandardMaterial;
  steel: THREE.MeshStandardMaterial;
  steelDark: THREE.MeshStandardMaterial;
  support: THREE.MeshStandardMaterial;
  tie: THREE.MeshStandardMaterial;
  canopy: THREE.MeshStandardMaterial;
  trim: THREE.MeshStandardMaterial;
  stucco: THREE.MeshStandardMaterial;
  roofDark: THREE.MeshStandardMaterial;
  gold: THREE.MeshStandardMaterial;
  seat: THREE.MeshStandardMaterial;
  /** Vertex-coloured standard material (striped tents, painted parts merged together). */
  vcol: THREE.MeshStandardMaterial;
  /** Vertex-coloured self-lit material (bulbs and signs of several colours in one draw). */
  vglow: THREE.MeshBasicMaterial;
  /** Shared self-lit material for a colour and strength (bloom picks up k > 1). */
  glow: (color: string, k?: number) => THREE.MeshBasicMaterial;
  /** Glossy painted steel or fibreglass in a colour (track spines, car bodies, signs). */
  painted: (color: string, rough?: number) => THREE.MeshStandardMaterial;
}

const kits = new WeakMap<ParkPalette, Kit>();

function makeKit(p: ParkPalette, light: boolean): Kit {
  const glows = new Map<string, THREE.MeshBasicMaterial>();
  const paints = new Map<string, THREE.MeshStandardMaterial>();
  const pave = tex('herringbone_pavement_diff.jpg', true);
  const paveNor = tex('herringbone_pavement_nor.jpg', false);
  const plankMap = tex('brown_planks_05_diff.jpg', true);
  const plankNor = tex('brown_planks_05_nor.jpg', false);
  const std = (color: string, roughness: number, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness, ...extra });
  return {
    p,
    light,
    lawn: std(p.lawn, 0.95, { map: tex('grass_ground_diff.jpg', true), normalMap: tex('grass_ground_nor.jpg', false), normalScale: new THREE.Vector2(0.7, 0.7) }),
    paving: std(p.paving, 0.85, { map: pave, normalMap: paveNor, normalScale: new THREE.Vector2(0.8, 0.8) }),
    pavingDark: std(p.pavingDark, 0.9, { map: pave, normalMap: paveNor, normalScale: new THREE.Vector2(0.8, 0.8) }),
    floor: std(p.paving, 0.9, { normalMap: paveNor, normalScale: new THREE.Vector2(0.5, 0.5) }),
    floorDark: std(p.pavingDark, 0.9, { normalMap: paveNor, normalScale: new THREE.Vector2(0.5, 0.5) }),
    curb: std(p.curb, 0.8),
    plank: std(p.plank, 0.8, { map: plankMap, normalMap: plankNor }),
    hedge: std(p.hedge, 0.9, { flatShading: true }),
    trunk: std(p.trunk, 0.9),
    steel: std(p.steel, 0.3, { metalness: 0.75 }),
    steelDark: std(p.steelDark, 0.45, { metalness: 0.6 }),
    support: std(p.support, 0.5, { metalness: 0.2 }),
    tie: std(p.tie, 0.5, { metalness: 0.5 }),
    canopy: std(p.canopy, 0.7, { side: THREE.DoubleSide }),
    trim: std(p.trim, 0.55),
    stucco: std(p.stucco, 0.85),
    roofDark: std(p.roofDark, 0.6, { flatShading: true }),
    gold: std(p.gold, 0.35, { metalness: 0.7 }),
    seat: std(p.seat, 0.6),
    vcol: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, side: THREE.DoubleSide }),
    vglow: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
    glow: (color, k = 2) => {
      const key = `${color}|${k}`;
      let m = glows.get(key);
      if (!m) glows.set(key, (m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), toneMapped: false })));
      return m;
    },
    painted: (color, rough = 0.32) => {
      const key = `${color}|${rough}`;
      let m = paints.get(key);
      if (!m) paints.set(key, (m = new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: 0.15 })));
      return m;
    },
  };
}

/** The kit for the active palette (Theme Park, or a recolour of it) and theme. */
export function useKit(): Kit {
  const p = useSkinPalette(PARK);
  const light = useResolvedTheme() === 'light';
  let kit = kits.get(p);
  if (!kit) kits.set(p, (kit = makeKit(p, light)));
  return kit;
}

/** True when a colour is the needs-you red (the ball is with the user): hue near red, strongly saturated. */
export function isAlarm(color: string): boolean {
  const c = new THREE.Color(color);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  return (hsl.h < 0.03 || hsl.h > 0.97) && hsl.s > 0.6 && hsl.l > 0.3;
}
