import * as THREE from 'three';
import { rng, useSkinPalette } from '../api';
import { SKY, type SkyPalette } from './palette';

/*
 * Sky Islands kit: textures (Poly Haven, CC0; see ASSETS.md), procedural rock islands, trees and stone,
 * and the shared materials. Textures load without suspending: materials exist at once and the images
 * fill in when they arrive, so the board never blanks while assets stream.
 */

export const ASSET_BASE = `${import.meta.env.BASE_URL}skins/skyislands/`;

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
 * Merges geometries that share attribute names into one indexed geometry. A local helper: importing
 * three/examples pulls a second copy of three into the dev bundle.
 */
export function mergeGeometries(list: THREE.BufferGeometry[], groups = false): THREE.BufferGeometry {
  const names = Object.keys(list[0].attributes);
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
    const start = io;
    if (g.index) for (let i = 0; i < g.index.count; i++) index[io++] = g.index.getX(i) + base;
    else for (let i = 0; i < n; i++) index[io++] = i + base;
    if (groups) out.addGroup(start, io - start, 0);
    base += n;
  }
  out.setIndex(new THREE.BufferAttribute(index, 1));
  return out;
}

/* ---------- noise ---------- */

function hash3(x: number, y: number, z: number, seed: number) {
  let h = Math.imul(x | 0, 374761393) ^ Math.imul(y | 0, 668265263) ^ Math.imul(z | 0, 2147483647) ^ Math.imul(seed | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Smooth value noise in [0, 1]. */
export function noise3(x: number, y: number, z: number, seed = 0): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = x - xi, yf = y - yi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf), w = zf * zf * (3 - 2 * zf);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  const h = (dx: number, dy: number, dz: number) => hash3(xi + dx, yi + dy, zi + dz, seed);
  return l(
    l(l(h(0, 0, 0), h(1, 0, 0), u), l(h(0, 1, 0), h(1, 1, 0), u), v),
    l(l(h(0, 0, 1), h(1, 0, 1), u), l(h(0, 1, 1), h(1, 1, 1), u), v),
    w,
  );
}

export function fbm3(x: number, y: number, z: number, seed = 0, octaves = 4): number {
  let v = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < octaves; i++) {
    v += a * noise3(x * f, y * f, z * f, seed + i * 17);
    n += a;
    a *= 0.5;
    f *= 2.03;
  }
  return v / n;
}

/* ---------- floating rock islands ---------- */

const RINGS = [0, 0.035, 0.07, 0.13, 0.21, 0.3, 0.4, 0.5, 0.6, 0.7, 0.79, 0.87, 0.93, 0.975, 1];
const SEG = 44;

export interface IslandGeo {
  /** Grass top, unit radius, y = 0 at the rim. */
  top: THREE.BufferGeometry;
  /** Grass lip (group 0) and the carved rock underside (group 1), hanging to about y = -depth. */
  under: THREE.BufferGeometry;
}

/** Rim radius around the island, shared by top and underside so they meet. */
function rimR(theta: number, seed: number) {
  return 1 + 0.09 * (fbm3(Math.cos(theta) * 1.6 + 5, Math.sin(theta) * 1.6 + 5, 0.5, seed, 3) - 0.5) * 2;
}

/**
 * A floating island of unit radius: a gently domed grass top and a carved underside that tapers to an
 * off-centre point, with vertical flutes that deepen toward the bottom (the painted "carved rock" look).
 */
export function islandGeometry(seed: number, depth = 1.5): IslandGeo {
  const r = rng(seed ^ 0x5bd1e995);
  const flutes = 7 + Math.floor(r() * 6);
  const tipX = (r() - 0.5) * 0.5;
  const tipZ = (r() - 0.5) * 0.5;
  const top = new THREE.Color(SKY.rockTop);
  const bottom = new THREE.Color(SKY.rockBottom);

  // underside
  const pos: number[] = [], uv: number[] = [], col: number[] = [], idx: number[] = [];
  const c = new THREE.Color();
  for (let j = 0; j < RINGS.length; j++) {
    const t = RINGS[j];
    for (let i = 0; i <= SEG; i++) {
      const th = (i / SEG) * Math.PI * 2;
      const cx = Math.cos(th), sz = Math.sin(th);
      const rim = rimR(th, seed);
      // lip: a small grass overhang, then the rock tucks in and tapers
      let shape: number;
      if (j === 0) shape = 1;
      else if (j === 1) shape = 1.025;
      else shape = 0.985 * Math.pow(1 - Math.pow(t, 1.15), 0.62) + 0.02;
      const n = fbm3(cx * 1.4, t * 2.6, sz * 1.4, seed, 4);
      const groove = Math.pow(0.5 + 0.5 * Math.sin(th * flutes + n * 7), 2.4);
      let rad = rim * shape;
      if (j > 1) rad *= 1 + (n - 0.5) * 0.42 - groove * 0.22 * Math.pow(t, 0.7);
      const hang = 1 + (fbm3(cx * 2.2 + 9, sz * 2.2, 3, seed, 3) - 0.5) * 0.9 * t;
      const y = j === 0 ? 0 : j === 1 ? -0.035 : -depth * t * hang - 0.04;
      const ox = tipX * t * t, oz = tipZ * t * t;
      pos.push(cx * rad + ox, y, sz * rad + oz);
      uv.push((i / SEG) * 5, -y * 1.15);
      const k = Math.min(1, t * 1.25);
      c.copy(top).lerp(bottom, k).multiplyScalar(1 - groove * 0.35 * Math.min(1, t * 2) - (1 - n) * 0.12);
      if (j <= 1) c.setRGB(1, 1, 1);
      col.push(c.r, c.g, c.b);
    }
  }
  const row = SEG + 1;
  for (let j = 0; j < RINGS.length - 1; j++)
    for (let i = 0; i < SEG; i++) {
      const a = j * row + i, b = a + 1, d = a + row, e = d + 1;
      idx.push(a, d, b, b, d, e);
    }
  const under = new THREE.BufferGeometry();
  under.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  under.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  under.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  under.setIndex(idx);
  under.addGroup(0, SEG * 6 * 2, 0);
  under.addGroup(SEG * 6 * 2, idx.length - SEG * 6 * 2, 1);
  under.computeVertexNormals();
  weldSeam(under, RINGS.length, row);

  // top: concentric rings out to the same rim
  const TR = [0, 0.2, 0.4, 0.6, 0.78, 0.9, 1];
  const tp: number[] = [], tu: number[] = [], ti: number[] = [];
  for (let j = 0; j < TR.length; j++) {
    const s = TR[j];
    for (let i = 0; i <= SEG; i++) {
      const th = (i / SEG) * Math.PI * 2;
      const rad = rimR(th, seed) * s;
      const x = Math.cos(th) * rad, z = Math.sin(th) * rad;
      const bump = (fbm3(x * 1.8, 2, z * 1.8, seed + 3, 3) - 0.4) * 0.12 * (1 - s * s) + 0.05 * (1 - s * s);
      tp.push(x, j === TR.length - 1 ? 0 : bump, z);
      tu.push(x * 0.5 + 0.5, z * 0.5 + 0.5);
    }
  }
  for (let j = 0; j < TR.length - 1; j++)
    for (let i = 0; i < SEG; i++) {
      const a = j * row + i, b = a + 1, d = a + row, e = d + 1;
      ti.push(a, b, d, b, e, d);
    }
  const topGeo = new THREE.BufferGeometry();
  topGeo.setAttribute('position', new THREE.Float32BufferAttribute(tp, 3));
  topGeo.setAttribute('uv', new THREE.Float32BufferAttribute(tu, 2));
  topGeo.setIndex(ti);
  topGeo.computeVertexNormals();
  return { top: topGeo, under };
}

/** The seam column of a lathe duplicates vertices; average their normals so no hard line shows. */
function weldSeam(g: THREE.BufferGeometry, rings: number, row: number) {
  const n = g.getAttribute('normal') as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let j = 0; j < rings; j++) {
    const a = j * row, b = a + row - 1;
    v.set(n.getX(a) + n.getX(b), n.getY(a) + n.getY(b), n.getZ(a) + n.getZ(b)).normalize();
    n.setXYZ(a, v.x, v.y, v.z);
    n.setXYZ(b, v.x, v.y, v.z);
  }
}

const islandCache = new Map<string, IslandGeo>();
/** One of a few cached island shapes, picked by seed. */
export function islandVariant(seed: number, depth = 1.5): IslandGeo {
  const key = `${seed % 6}|${depth}`;
  let g = islandCache.get(key);
  if (!g) islandCache.set(key, (g = islandGeometry(1000 + (seed % 6) * 7919, depth)));
  return g;
}

/** An island shape placed and scaled into a merged list: radius rx (x) by rz (z), depth scale ry. */
export function placeIsland(g: IslandGeo, x: number, y: number, z: number, rx: number, ry: number, rz: number, rotY = 0) {
  const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY), new THREE.Vector3(rx, ry, rz));
  const top = g.top.clone().applyMatrix4(m);
  const under = g.under.clone().applyMatrix4(m);
  return { top, under };
}

/** Merges placed islands; the underside keeps its two groups (lip, rock). */
export function mergeIslands(parts: { top: THREE.BufferGeometry; under: THREE.BufferGeometry }[]) {
  const top = mergeGeometries(parts.map((p) => p.top));
  const under = mergeGeometries(parts.map((p) => p.under), true);
  // mergeGeometries with groups makes one group per input; regroup lip/rock by material index
  const groups: { start: number; count: number; materialIndex: number }[] = [];
  let offset = 0;
  for (const p of parts) {
    for (const gr of p.under.groups) groups.push({ start: offset + gr.start, count: gr.count, materialIndex: gr.materialIndex ?? 0 });
    offset += p.under.index!.count;
  }
  under.clearGroups();
  for (const gr of groups) under.addGroup(gr.start, gr.count, gr.materialIndex);
  return { top, under };
}

/* ---------- trees, bushes and boulders ---------- */

/** A broadleaf tree: short trunk under a clump of lumpy foliage balls, coloured light on top and dark below. */
function treeGeometry(seed: number, bush = false): THREE.BufferGeometry {
  const r = rng(seed);
  const parts: THREE.BufferGeometry[] = [];
  const trunkC = new THREE.Color(SKY.trunk);
  const dark = new THREE.Color(SKY.foliage);
  const lit = new THREE.Color(SKY.foliageLit);
  const paint = (g: THREE.BufferGeometry, fn: (x: number, y: number, z: number, nx: number, ny: number, nz: number) => THREE.Color) => {
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    const cols = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const c = fn(p.getX(i), p.getY(i), p.getZ(i), n.getX(i), n.getY(i), n.getZ(i));
      cols.set([c.r, c.g, c.b], i * 3);
    }
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    return g;
  };
  const trunkH = bush ? 0.15 : 0.55 + r() * 0.2;
  if (!bush) {
    const trunk = new THREE.CylinderGeometry(0.06, 0.1, trunkH, 6);
    trunk.translate(0, trunkH / 2, 0);
    parts.push(paint(trunk, () => trunkC));
  }
  const blobs = bush ? 3 + Math.floor(r() * 2) : 6 + Math.floor(r() * 3);
  const height = bush ? 0.45 : trunkH + 0.75;
  const c = new THREE.Color();
  for (let b = 0; b < blobs; b++) {
    const rad = (bush ? 0.18 : 0.24) + r() * (bush ? 0.1 : 0.16);
    const g = new THREE.SphereGeometry(rad, 9, 6);
    const a = r() * Math.PI * 2;
    const off = b === 0 ? 0 : (bush ? 0.2 : 0.32) * (0.5 + r() * 0.7);
    const cy = (bush ? 0.2 : trunkH + 0.3) + (b === 0 ? (bush ? 0.08 : 0.35) : r() * (bush ? 0.1 : 0.35));
    const p = g.getAttribute('position') as THREE.BufferAttribute;
    const nrm = g.getAttribute('normal') as THREE.BufferAttribute;
    const ctr = new THREE.Vector3(Math.cos(a) * off, cy, Math.sin(a) * off);
    const v = new THREE.Vector3();
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      const k = 1 + (noise3(x * 7 + b * 3, y * 7, z * 7, seed) - 0.5) * 0.3;
      p.setXYZ(i, x * k + ctr.x, y * k * 0.88 + ctr.y, z * k + ctr.z);
      // soft, sphere-like normals: canopies read as fluffy volumes, not facets
      v.set(x, y * 1.1, z).normalize();
      nrm.setXYZ(i, v.x, v.y, v.z);
    }
    parts.push(
      paint(g, (_x, y, _z, nx, ny, nz) => {
        const up = Math.max(0, ny) * 0.6 + Math.max(0, -nx * 0.4 - nz * 0.3) * 0.4;
        const h = Math.min(1, Math.max(0, y / height));
        return c.copy(dark).multiplyScalar(0.6 + 0.4 * h).lerp(lit, up * 0.7 * (0.4 + 0.6 * h));
      }),
    );
  }
  for (const g of parts) g.deleteAttribute('uv');
  return mergeGeometries(parts);
}

export const TREE_GEOS: THREE.BufferGeometry[] = [11, 23, 37].map((s) => treeGeometry(s));
export const BUSH_GEO = treeGeometry(51, true);

/** A lumpy boulder for island edges. */
export const BOULDER_GEO = (() => {
  const g = new THREE.IcosahedronGeometry(0.3, 1);
  const p = g.getAttribute('position') as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = 0.75 + noise3(x * 5, y * 5, z * 5, 7) * 0.5;
    p.setXYZ(i, x * k * 1.2, Math.max(-0.05, y * k * 0.7), z * k);
  }
  g.computeVertexNormals();
  return g;
})();

/* ---------- boxes with texture density ---------- */

/** A box whose UVs repeat with its size (density = repeats per unit), so stone and plank stay in scale. */
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

/* ---------- materials ---------- */

/**
 * Height haze: the lower a fragment sits, the more it takes the cloud-sea colour, so island undersides
 * dissolve downward into the mist as in the painting. World y from `top` (clear) to `bottom` (k of haze).
 */
export function withHeightHaze<T extends THREE.Material>(mat: T, color: string, top = 3.5, bottom = -4, k = 0.7): T {
  const hazeCol = { value: new THREE.Color(color) };
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.hazeCol = hazeCol;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vHazeY;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvHazeY = (modelMatrix * vec4(transformed, 1.0)).y;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform vec3 hazeCol;\nvarying float vHazeY;')
      .replace('#include <fog_fragment>', `gl_FragColor.rgb = mix(gl_FragColor.rgb, hazeCol, smoothstep(${top.toFixed(2)}, ${bottom.toFixed(2)}, vHazeY) * ${k.toFixed(2)});\n#include <fog_fragment>`);
  };
  mat.customProgramCacheKey = () => `haze|${top}|${bottom}|${k}`;
  return mat;
}

export interface Kit {
  p: SkyPalette;
  grass: THREE.MeshStandardMaterial;
  lip: THREE.MeshStandardMaterial;
  rock: THREE.MeshStandardMaterial;
  stone: THREE.MeshStandardMaterial;
  stoneDark: THREE.MeshStandardMaterial;
  slate: THREE.MeshStandardMaterial;
  plank: THREE.MeshStandardMaterial;
  plankDark: THREE.MeshStandardMaterial;
  iron: THREE.MeshStandardMaterial;
  foliage: THREE.MeshStandardMaterial;
  boulder: THREE.MeshStandardMaterial;
  /** Shared self-lit material for a colour and strength (bloom picks up k > 1). */
  glow: (color: string, k?: number) => THREE.MeshBasicMaterial;
  /** Painted wood in a colour (pods, crate bands). */
  painted: (color: string) => THREE.MeshStandardMaterial;
}

const kits = new WeakMap<SkyPalette, Kit>();

/** Per-channel ratio a / b, so a material colour can shift baked vertex colours toward a recolour. */
function ratio(a: string, b: string) {
  const x = new THREE.Color(a), y = new THREE.Color(b);
  return new THREE.Color(x.r / Math.max(0.01, y.r), x.g / Math.max(0.01, y.g), x.b / Math.max(0.01, y.b));
}

function makeKit(p: SkyPalette): Kit {
  const glows = new Map<string, THREE.MeshBasicMaterial>();
  const paints = new Map<string, THREE.MeshStandardMaterial>();
  const grassMap = tex('leafy_grass_diff.jpg', true, [2, 2]);
  const grassNor = tex('leafy_grass_nor.jpg', false, [2, 2]);
  const plankNor = tex('brown_planks_03_nor.jpg', false);
  return {
    p,
    grass: new THREE.MeshStandardMaterial({ color: p.grass, map: grassMap, normalMap: grassNor, normalScale: new THREE.Vector2(0.8, 0.8), roughness: 0.95 }),
    lip: new THREE.MeshStandardMaterial({ color: p.grassLip, map: grassMap, roughness: 0.95 }),
    rock: withHeightHaze(new THREE.MeshStandardMaterial({
      // the vertex colours bake the default rock gradient; a recolour tints relative to it
      color: ratio(p.rockTop, SKY.rockTop),
      map: tex('cliff_side_diff.jpg', true),
      normalMap: tex('cliff_side_nor.jpg', false),
      normalScale: new THREE.Vector2(1.4, 1.4),
      vertexColors: true,
      roughness: 0.92,
    }), p.haze),
    stone: new THREE.MeshStandardMaterial({ color: p.stone, map: tex('rock_wall_08_diff.jpg', true), normalMap: tex('rock_wall_08_nor.jpg', false), roughness: 0.88 }),
    stoneDark: new THREE.MeshStandardMaterial({ color: p.stoneDark, map: tex('rock_wall_08_diff.jpg', true), normalMap: tex('rock_wall_08_nor.jpg', false), roughness: 0.9 }),
    slate: new THREE.MeshStandardMaterial({ color: p.slate, map: tex('roof_slates_02_diff.jpg', true), normalMap: tex('roof_slates_02_nor.jpg', false), roughness: 0.75 }),
    plank: new THREE.MeshStandardMaterial({ color: p.plank, map: tex('brown_planks_03_diff.jpg', true), normalMap: plankNor, roughness: 0.85 }),
    plankDark: new THREE.MeshStandardMaterial({ color: p.plankDark, map: tex('brown_planks_03_diff.jpg', true), normalMap: plankNor, roughness: 0.9 }),
    iron: new THREE.MeshStandardMaterial({ color: p.iron, roughness: 0.55, metalness: 0.6 }),
    foliage: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, normalMap: grassNor, normalScale: new THREE.Vector2(0.5, 0.5) }),
    boulder: new THREE.MeshStandardMaterial({ color: p.boulder, map: tex('cliff_side_diff.jpg', true), normalMap: tex('cliff_side_nor.jpg', false), roughness: 0.9 }),
    glow: (color, k = 2) => {
      const key = `${color}|${k}`;
      let m = glows.get(key);
      if (!m) glows.set(key, (m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), toneMapped: false })));
      return m;
    },
    painted: (color) => {
      let m = paints.get(color);
      if (!m) paints.set(color, (m = new THREE.MeshStandardMaterial({ color, normalMap: plankNor, normalScale: new THREE.Vector2(0.6, 0.6), roughness: 0.6 })));
      return m;
    },
  };
}

/** The kit for the active palette (Sky Islands, or a recolour of it). */
export function useKit(): Kit {
  const p = useSkinPalette(SKY);
  let kit = kits.get(p);
  if (!kit) kits.set(p, (kit = makeKit(p)));
  return kit;
}
