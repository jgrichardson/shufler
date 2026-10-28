import * as THREE from 'three';
import { useResolvedTheme, useSkinPalette } from '../api';
import { COMMAND, type CommandPalette } from './palette';

/*
 * Command Post kit: geometry helpers (merge by material, boxes, posts, struts, vertex paint), canvas-drawn
 * textures (the map grid and contours, generic blob camo for nets, corrugated iron, stencil lettering) and
 * the shared materials. Everything is procedural: no downloads. Lettering is Inter (bundled) with stencil
 * bridges cut into each glyph on the canvas, and is redrawn once the web font has loaded.
 */

/** World height of the sand table (the map); compounds, causeways and landmark pads rise from it. */
export const GROUND_Y = 2.6;
/** World height of the low ground past the end of the roads, where the depot and helipad stand. */
export const LOWER_Y = -0.55;

/** A canvas of the given size, or null outside a browser (tests). */
export function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] | null {
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  return g ? [c, g] : null;
}

export function canvasTexture(c: HTMLCanvasElement, repeat = false, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/* ---------- lettering ---------- */

export const STENCIL_FONT = 'Inter, "Helvetica Neue", Arial, sans-serif';
export const MONO_FONT = '"JetBrains Mono", ui-monospace, Menlo, monospace';

/** Glyphs that keep no bridge (thin or open shapes). */
const NO_BRIDGE = new Set([' ', 'I', '1', '-', '·', '.', ':', '/', 'L', 'T', 'J', 'Y', 'V', 'X', 'K', 'F', 'H', 'N', 'M', 'W', 'Z', '7', 'i', 'l']);

/**
 * Stencil lettering: bold Inter, letter-spaced and centred on x, then the bridges a stencil plate leaves
 * (a slit through the top and bottom of every closed or curved letter) cut out of the canvas so the
 * background shows through. Draws the background first if `bg` is given, because the cut clears to it.
 */
export function stencilText(
  g: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  size: number,
  color: string,
  { spacing = size * 0.12, bg, weight = 700, mono = false }: { spacing?: number; bg?: string; weight?: number; mono?: boolean } = {},
) {
  g.save();
  g.font = `${weight} ${size}px ${mono ? MONO_FONT : STENCIL_FONT}`;
  g.textBaseline = 'middle';
  g.textAlign = 'center';
  const chars = [...text];
  const ws = chars.map((ch) => g.measureText(ch).width + spacing);
  let cx = x - (ws.reduce((a, b) => a + b, 0) - spacing) / 2;
  const centres: [string, number, number][] = [];
  g.fillStyle = color;
  chars.forEach((ch, i) => {
    const w = ws[i] - spacing;
    g.fillText(ch, cx + w / 2, y);
    centres.push([ch, cx + w / 2, w]);
    cx += ws[i];
  });
  // the bridges: slits through the top and bottom strokes, painted back in the background colour
  const slit = Math.max(1.5, size * 0.075);
  const cap = size * 0.36;
  for (const [ch, mx] of centres) {
    if (NO_BRIDGE.has(ch)) continue;
    if (bg) {
      g.fillStyle = bg;
      g.fillRect(mx - slit / 2, y - cap - size * 0.05, slit, size * 0.3);
      g.fillRect(mx - slit / 2, y + cap * 0.45, slit, size * 0.3);
    } else {
      g.globalCompositeOperation = 'destination-out';
      g.fillRect(mx - slit / 2, y - cap - size * 0.05, slit, size * 0.3);
      g.fillRect(mx - slit / 2, y + cap * 0.45, slit, size * 0.3);
      g.globalCompositeOperation = 'source-over';
    }
  }
  g.restore();
}

/** Measured width of stencil text, for fitting a line into a plate. */
export function stencilWidth(g: CanvasRenderingContext2D, text: string, size: number, spacing = size * 0.12, mono = false, weight = 700) {
  g.save();
  g.font = `${weight} ${size}px ${mono ? MONO_FONT : STENCIL_FONT}`;
  const w = [...text].reduce((a, ch) => a + g.measureText(ch).width + spacing, -spacing);
  g.restore();
  return w;
}

const redraws: (() => void)[] = [];
let fontsLoaded = false;
if (typeof document !== 'undefined' && document.fonts?.load) {
  Promise.all([document.fonts.load(`700 64px Inter`), document.fonts.load(`400 64px "JetBrains Mono"`)])
    .then(() => {
      fontsLoaded = true;
      for (const r of redraws.splice(0)) r();
    })
    .catch(() => undefined);
}

/**
 * A texture drawn on a canvas that carries lettering. If the web font is not loaded yet it is drawn now in
 * the fallback and drawn again once Inter arrives, so signs never stay in the wrong face.
 */
export function lettered(w: number, h: number, draw: (g: CanvasRenderingContext2D, w: number, h: number) => void, srgb = true): THREE.CanvasTexture | null {
  const made = canvas(w, h);
  if (!made) return null;
  const [c, g] = made;
  draw(g, w, h);
  const t = canvasTexture(c, false, srgb);
  if (!fontsLoaded)
    redraws.push(() => {
      g.clearRect(0, 0, w, h);
      draw(g, w, h);
      t.needsUpdate = true;
    });
  return t;
}

/** The house monogram: a stencilled S in a rounded square with a chevron underline. */
export function monogram(g: CanvasRenderingContext2D, cx: number, cy: number, s: number, ink: string, bg: string) {
  g.save();
  g.strokeStyle = ink;
  g.lineWidth = s * 0.08;
  roundRect(g, cx - s / 2, cy - s / 2, s, s, s * 0.18);
  g.stroke();
  stencilText(g, 'S', cx, cy - s * 0.08, s * 0.62, ink, { bg, spacing: 0 });
  // the chevron underline points forward, along the road
  g.fillStyle = ink;
  g.beginPath();
  const y = cy + s * 0.3;
  g.moveTo(cx - s * 0.26, y - s * 0.04);
  g.lineTo(cx, y + s * 0.06);
  g.lineTo(cx + s * 0.26, y - s * 0.04);
  g.lineTo(cx + s * 0.26, y + s * 0.04);
  g.lineTo(cx, y + s * 0.14);
  g.lineTo(cx - s * 0.26, y + s * 0.04);
  g.closePath();
  g.fill();
  g.restore();
}

/* ---------- geometry ---------- */

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
  /** Adds a geometry painted a flat vertex colour to the vertex-coloured bucket `key`. */
  paint(key: string, g: THREE.BufferGeometry, color: string | THREE.Color, k = 1) {
    return this.add(key, paint(g, color, k));
  }
  merged(): Record<string, THREE.BufferGeometry> {
    const out: Record<string, THREE.BufferGeometry> = {};
    for (const [k, list] of this.bins) out[k] = mergeGeometries(list);
    return out;
  }
}

/** A box whose UVs repeat with its size (density = repeats per unit). */
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

/** A vertical post from y0 to y1 at (x, z). */
export function post(x: number, z: number, y0: number, y1: number, r: number, seg = 8): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(r, r, y1 - y0, seg).translate(x, (y0 + y1) / 2, z);
}

/** A cylinder (rod) from point a to point b. */
export function strut(a: THREE.Vector3, b: THREE.Vector3, r: number, seg = 6): THREE.BufferGeometry {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r, r, len, seg, 1, false);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  g.applyQuaternion(q);
  const m = a.clone().add(b).multiplyScalar(0.5);
  return g.translate(m.x, m.y, m.z);
}

export const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/** Strips normals and UVs so a self-lit geometry merges with others of the same kind. */
export function bare(g: THREE.BufferGeometry): THREE.BufferGeometry {
  g.deleteAttribute('uv');
  g.deleteAttribute('normal');
  return g;
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

/** A rounded rectangle shape centred on the origin. */
export function roundedRect(w: number, h: number, r: number): THREE.Shape {
  const s = new THREE.Shape();
  const x = -w / 2;
  const y = -h / 2;
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/** A bevelled box (rounded vertical edges, chamfered top), the chunky toy look, base at y = 0. */
export function chunk(w: number, h: number, d: number, bevel = 0.08): THREE.BufferGeometry {
  const b = Math.min(bevel, w / 4, d / 4, h / 4);
  const g = new THREE.ExtrudeGeometry(roundedRect(w - 2 * b, d - 2 * b, Math.min(w, d) * 0.08), {
    depth: h - 2 * b,
    bevelEnabled: true,
    bevelThickness: b,
    bevelSize: b,
    bevelSegments: 1,
    curveSegments: 2,
  });
  g.rotateX(-Math.PI / 2);
  g.translate(0, b, 0);
  g.computeVertexNormals();
  return g;
}

/** A flat shape lying in the xz plane, facing up, with 0..1 UVs (top of the shape toward -z). */
export function flatShape(shape: THREE.Shape, w: number, h: number): THREE.BufferGeometry {
  const g = new THREE.ShapeGeometry(shape, 6);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const uv = g.getAttribute('uv') as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, (pos.getX(i) + w / 2) / w, (pos.getY(i) + h / 2) / h);
  g.rotateX(-Math.PI / 2);
  return g;
}

/** A regular hexagon with rounded corners (flat sides front and back), for the tabletop counters. */
export function hexShape(r: number, round = 0.12): THREE.Shape {
  const s = new THREE.Shape();
  const pts = Array.from({ length: 6 }, (_, i) => {
    const a = (i / 6) * Math.PI * 2;
    return new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r);
  });
  for (let i = 0; i < 6; i++) {
    const p = pts[i];
    const prev = pts[(i + 5) % 6];
    const next = pts[(i + 1) % 6];
    const a = p.clone().lerp(prev, round);
    const b = p.clone().lerp(next, round);
    if (i === 0) s.moveTo(a.x, a.y);
    else s.lineTo(a.x, a.y);
    s.quadraticCurveTo(p.x, p.y, b.x, b.y);
  }
  s.closePath();
  return s;
}

/* ---------- canvas patterns ---------- */

/** Seeded random numbers for canvas drawing. */
function seeded(seed: number) {
  let s = seed % 2147483647 || 1;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

/** World units covered by one repeat of the map texture. */
export const MAP_TILE = 56;

/**
 * The map: printed grid squares (a fine line every 7 units, a heavier one every 28) and contour lines
 * from a periodic height field, so the texture tiles. Mapped in world units on the ground and the compound
 * tops, so stretched islands do not distort it.
 */
function mapCanvas(base: string, alt: string, line: string, light: boolean): HTMLCanvasElement | null {
  const S = 512;
  const made = canvas(S, S);
  if (!made) return null;
  const [c, g] = made;
  g.fillStyle = base;
  g.fillRect(0, 0, S, S);
  // a periodic height field: a few sines that repeat across the tile
  const field = (x: number, y: number) => {
    const u = (x / S) * Math.PI * 2;
    const v = (y / S) * Math.PI * 2;
    return Math.sin(u) * 0.9 + Math.cos(v * 2 + 0.7) * 0.6 + Math.sin(u + v * 1) * 0.55 + Math.cos(u * 3 - v * 2) * 0.25 + Math.sin(u * 2 + v * 3 + 1.3) * 0.2;
  };
  const img = g.getImageData(0, 0, S, S);
  const a = new THREE.Color(alt);
  const l = new THREE.Color(line);
  const rnd = seeded(91);
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const f = field(x, y);
      const i = (y * S + x) * 4;
      // terraces: alternate bands a touch darker, and a thin contour line at each band edge
      const band = Math.floor(f * 1.5);
      const frac = f * 1.5 - band;
      const noise = (rnd() - 0.5) * (light ? 6 : 5);
      let r = img.data[i] + noise;
      let gg = img.data[i + 1] + noise;
      let b = img.data[i + 2] + noise;
      if (band % 2) {
        r = r * 0.8 + a.r * 255 * 0.2;
        gg = gg * 0.8 + a.g * 255 * 0.2;
        b = b * 0.8 + a.b * 255 * 0.2;
      }
      const edge = Math.min(frac, 1 - frac);
      if (edge < 0.022) {
        const k = light ? 0.26 : 0.3;
        r = r * (1 - k) + l.r * 255 * k;
        gg = gg * (1 - k) + l.g * 255 * k;
        b = b * (1 - k) + l.b * 255 * k;
      }
      img.data[i] = r;
      img.data[i + 1] = gg;
      img.data[i + 2] = b;
    }
  g.putImageData(img, 0, 0);
  // grid squares: 8 per tile, every fourth heavier
  g.strokeStyle = line;
  for (let k = 0; k <= 8; k++) {
    const p = (k / 8) * S;
    g.globalAlpha = k % 4 === 0 ? (light ? 0.55 : 0.5) : light ? 0.28 : 0.26;
    g.lineWidth = k % 4 === 0 ? 2.2 : 1.2;
    g.beginPath();
    g.moveTo(p, 0);
    g.lineTo(p, S);
    g.moveTo(0, p);
    g.lineTo(S, p);
    g.stroke();
  }
  g.globalAlpha = 1;
  return c;
}

/** Generic two-tone blob camo for nets: seeded round blobs, wrapped so the tile repeats. Not a real pattern. */
function camoCanvas(a: string, b: string, cc: string): HTMLCanvasElement | null {
  const S = 256;
  const made = canvas(S, S);
  if (!made) return null;
  const [c, g] = made;
  g.fillStyle = a;
  g.fillRect(0, 0, S, S);
  const rnd = seeded(4242);
  for (const [col, n, r0] of [[b, 22, 26], [cc, 16, 18]] as [string, number, number][]) {
    g.fillStyle = col;
    for (let i = 0; i < n; i++) {
      const x = rnd() * S;
      const y = rnd() * S;
      const r = r0 * (0.6 + rnd() * 0.8);
      for (const dx of [-S, 0, S])
        for (const dy of [-S, 0, S]) {
          g.beginPath();
          g.ellipse(x + dx, y + dy, r * 1.4, r, rnd() * Math.PI, 0, Math.PI * 2);
          g.fill();
        }
    }
  }
  // the net's mesh: a fine diagonal lattice
  g.strokeStyle = 'rgba(0,0,0,0.35)';
  g.lineWidth = 1;
  for (let k = -S; k < S * 2; k += 10) {
    g.beginPath();
    g.moveTo(k, 0);
    g.lineTo(k + S, S);
    g.moveTo(k, S);
    g.lineTo(k + S, 0);
    g.stroke();
  }
  return c;
}

/** Corrugated iron as a normal map: ribs across u. */
function corrugatedCanvas(): HTMLCanvasElement | null {
  const made = canvas(64, 4);
  if (!made) return null;
  const [c, g] = made;
  const img = g.createImageData(64, 4);
  for (let x = 0; x < 64; x++) {
    const nx = Math.cos((x / 64) * Math.PI * 2 * 4) * 0.7;
    const nz = Math.sqrt(1 - nx * nx);
    for (let y = 0; y < 4; y++) {
      const i = (y * 64 + x) * 4;
      img.data[i] = (nx * 0.5 + 0.5) * 255;
      img.data[i + 1] = 128;
      img.data[i + 2] = (nz * 0.5 + 0.5) * 255;
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** Soft round light for floodlight pools and the bokeh of far lamps. */
function softCanvas(): HTMLCanvasElement | null {
  const made = canvas(128, 128);
  if (!made) return null;
  const [c, g] = made;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 62);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  return c;
}

/* ---------- materials ---------- */

export interface Kit {
  p: CommandPalette;
  light: boolean;
  /** Vertex-coloured paint: olive, khaki, steel and timber parts merged into one draw. */
  vcol: THREE.MeshStandardMaterial;
  /** Vertex-coloured self-lit material. */
  vglow: THREE.MeshBasicMaterial;
  terrain: THREE.MeshStandardMaterial;
  /** The map printed on compound tops and pads (same texture, a little lighter). */
  mapTop: THREE.MeshStandardMaterial;
  cliff: THREE.MeshStandardMaterial;
  road: THREE.MeshStandardMaterial;
  olive: THREE.MeshStandardMaterial;
  oliveDark: THREE.MeshStandardMaterial;
  khaki: THREE.MeshStandardMaterial;
  canvasTent: THREE.MeshStandardMaterial;
  netting: THREE.MeshStandardMaterial;
  steel: THREE.MeshStandardMaterial;
  tyre: THREE.MeshStandardMaterial;
  timber: THREE.MeshStandardMaterial;
  concrete: THREE.MeshStandardMaterial;
  corrugated: THREE.MeshStandardMaterial;
  bezel: THREE.MeshStandardMaterial;
  opsBoard: THREE.MeshStandardMaterial;
  stencil: THREE.MeshStandardMaterial;
  softMap: THREE.Texture | null;
  /** Shared self-lit material for a colour and strength (bloom picks up k > 1). */
  glow: (color: string, k?: number) => THREE.MeshBasicMaterial;
  /** Paint in a colour (row and phase colours). */
  painted: (color: string, rough?: number) => THREE.MeshStandardMaterial;
  /** A soft additive pool of light on the ground, in a colour. */
  pool: (color: string, opacity: number) => THREE.MeshBasicMaterial;
}

const kits = new WeakMap<CommandPalette, Kit>();

function makeKit(p: CommandPalette, light: boolean): Kit {
  const glows = new Map<string, THREE.MeshBasicMaterial>();
  const paints = new Map<string, THREE.MeshStandardMaterial>();
  const pools = new Map<string, THREE.MeshBasicMaterial>();
  const std = (color: string, roughness: number, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color, roughness, metalness: 0, ...extra });
  const mapC = mapCanvas(p.terrain, p.terrainAlt, p.gridLine, light);
  const mapTex = mapC ? canvasTexture(mapC, true) : null;
  const camoC = camoCanvas(p.netting, p.olive, p.khaki);
  const camo = camoC ? canvasTexture(camoC, true) : null;
  camo?.repeat.set(2, 2);
  const corrC = corrugatedCanvas();
  const corr = corrC ? canvasTexture(corrC, true, false) : null;
  const softC = softCanvas();
  return {
    p,
    light,
    vcol: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.82 }),
    vglow: new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }),
    terrain: std('#ffffff', 0.95, { map: mapTex }),
    // compound tops: the same map, lifted a step brighter than the ground so the compounds stand out
    mapTop: std('#ffffff', 0.92, { map: mapTex, color: light ? new THREE.Color(1.12, 1.1, 1.03) : new THREE.Color(1.35, 1.32, 1.22) }),
    cliff: std(p.khaki, 0.95, { color: new THREE.Color(p.terrainAlt).lerp(new THREE.Color(p.khaki), 0.35) }),
    road: std(p.road, 0.95),
    olive: std(p.olive, 0.78),
    oliveDark: std(p.oliveDark, 0.8),
    khaki: std(p.khaki, 0.88),
    canvasTent: std(p.canvasTent, 0.92),
    netting: std('#ffffff', 0.95, { map: camo, transparent: false, side: THREE.DoubleSide }),
    steel: std(p.steel, 0.5, { metalness: 0.5 }),
    tyre: std(p.tyre, 0.9),
    timber: std(p.timber, 0.85),
    concrete: std(p.concrete, 0.9),
    corrugated: std(p.steel, 0.55, { metalness: 0.35, normalMap: corr, normalScale: new THREE.Vector2(0.9, 0.9) }),
    bezel: std(p.bezel, 0.6),
    opsBoard: std(p.opsBoard, 0.85),
    stencil: std(p.stencil, 0.7),
    softMap: softC ? canvasTexture(softC) : null,
    glow: (color, k = 2) => {
      const key = `${color}|${k}`;
      let m = glows.get(key);
      if (!m) glows.set(key, (m = new THREE.MeshBasicMaterial({ color: new THREE.Color(color).multiplyScalar(k), toneMapped: false })));
      return m;
    },
    painted: (color, rough = 0.6) => {
      const key = `${color}|${rough}`;
      let m = paints.get(key);
      if (!m) paints.set(key, (m = std(color, rough)));
      return m;
    },
    pool: (color, opacity) => {
      const key = `${color}|${opacity}`;
      let m = pools.get(key);
      if (!m)
        pools.set(
          key,
          (m = new THREE.MeshBasicMaterial({ color, map: softC ? canvasTexture(softC) : null, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false })),
        );
      return m;
    },
  };
}

/** The kit for the active palette (Command Post, or a recolour of it) and theme. */
export function useKit(): Kit {
  const p = useSkinPalette(COMMAND);
  const light = useResolvedTheme() === 'light';
  let kit = kits.get(p);
  if (!kit) kits.set(p, (kit = makeKit(p, light)));
  return kit;
}

/** Ground UVs in world units: one map tile per MAP_TILE, offset by the mesh's world position. */
export function worldUV(g: THREE.BufferGeometry, ox = 0, oz = 0, sx = 1): THREE.BufferGeometry {
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const uv = g.getAttribute('uv') as THREE.BufferAttribute | undefined;
  const arr = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    arr[i * 2] = (pos.getX(i) * sx + ox) / MAP_TILE;
    arr[i * 2 + 1] = -(pos.getZ(i) + oz) / MAP_TILE;
  }
  if (uv && uv.count === pos.count) uv.array.set(arr);
  else g.setAttribute('uv', new THREE.BufferAttribute(arr, 2));
  (g.getAttribute('uv') as THREE.BufferAttribute).needsUpdate = true;
  return g;
}

/** True when a colour is the needs-you red (the ball is with the user): hue near red, strongly saturated. */
export function isAlarm(color: string): boolean {
  const c = new THREE.Color(color);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  return (hsl.h < 0.03 || hsl.h > 0.97) && hsl.s > 0.6 && hsl.l > 0.3;
}

/** A small stable hash of a string. */
export function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}
